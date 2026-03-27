import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeImagesCommand,
  type Instance,
  type Reservation,
} from "@aws-sdk/client-ec2";
import {
  RDSClient,
  DescribeDBInstancesCommand,
  type DBInstance,
} from "@aws-sdk/client-rds";
import {
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  type Service as EcsService,
} from "@aws-sdk/client-ecs";
import {
  LambdaClient,
  ListFunctionsCommand,
  type FunctionConfiguration,
} from "@aws-sdk/client-lambda";
import { BaseScanner } from "../base-scanner.js";
import type {
  ScanResult,
  ScanTargetConfig,
  HostInventory,
  PackageInfo,
} from "../types.js";
import { parseImageRef, imagesToPackages } from "./kubernetes-scanner.js";

export interface AwsConnectionConfig {
  region: string;
  /** Scan multiple regions; if omitted only `region` is scanned */
  regions?: string[];
  accessKeyId?: string;
  secretAccessKey?: string;
  profile?: string;
}

// ─── Pure helpers (testable) ───

export function ec2InstanceToHost(
  instance: Instance,
  amiDescription?: string
): HostInventory {
  const nameTag = instance.Tags?.find((t) => t.Key === "Name")?.Value;
  const hostname = nameTag || instance.InstanceId || "unknown";

  const packages: PackageInfo[] = [];
  if (instance.ImageId) {
    packages.push({
      name: instance.ImageId,
      installedVersion: amiDescription || instance.ImageId,
      packageManager: "ami",
      ecosystem: "aws",
    });
  }

  return {
    hostname,
    ip: instance.PrivateIpAddress ?? "",
    os: instance.Platform ?? "linux",
    osVersion: amiDescription ?? "unknown",
    arch: instance.Architecture ?? "x86_64",
    packages,
    services: [],
    metadata: {
      instanceId: instance.InstanceId,
      instanceType: instance.InstanceType,
      availabilityZone: instance.Placement?.AvailabilityZone,
      vpcId: instance.VpcId,
      securityGroups: (instance.SecurityGroups ?? []).map((sg) => ({
        id: sg.GroupId,
        name: sg.GroupName,
      })),
      state: instance.State?.Name,
      launchTime: instance.LaunchTime?.toISOString(),
      region: instance.Placement?.AvailabilityZone?.slice(0, -1),
    },
  };
}

export function rdsInstanceToHost(db: DBInstance): HostInventory {
  const packages: PackageInfo[] = [];
  if (db.Engine && db.EngineVersion) {
    packages.push({
      name: db.Engine,
      installedVersion: db.EngineVersion,
      packageManager: "rds",
      ecosystem: "aws",
    });
  }

  return {
    hostname: db.DBInstanceIdentifier ?? "unknown",
    ip: db.Endpoint?.Address ?? "",
    os: db.Engine ?? "unknown",
    osVersion: db.EngineVersion ?? "unknown",
    arch: "",
    packages,
    services: [
      {
        name: db.DBInstanceIdentifier ?? "unknown",
        serviceType: "database",
        version: db.EngineVersion,
        port: db.Endpoint?.Port,
        status: db.DBInstanceStatus ?? "unknown",
      },
    ],
    metadata: {
      instanceClass: db.DBInstanceClass,
      multiAz: db.MultiAZ,
      storageType: db.StorageType,
      allocatedStorage: db.AllocatedStorage,
      endpoint: db.Endpoint?.Address,
      port: db.Endpoint?.Port,
    },
  };
}

export function lambdaFunctionToHost(fn: FunctionConfiguration): HostInventory {
  const runtime = fn.Runtime ?? "unknown";
  const packages: PackageInfo[] = [
    {
      name: runtime,
      installedVersion: runtime,
      packageManager: "lambda",
      ecosystem: "aws",
    },
  ];

  // Also include layers as packages
  for (const layer of fn.Layers ?? []) {
    if (layer.Arn) {
      const layerName = layer.Arn.split(":").slice(-2, -1)[0] ?? layer.Arn;
      packages.push({
        name: layerName,
        installedVersion: layer.Arn.split(":").pop() ?? "unknown",
        packageManager: "lambda-layer",
        ecosystem: "aws",
      });
    }
  }

  return {
    hostname: fn.FunctionName ?? "unknown",
    ip: "",
    os: "aws-lambda",
    osVersion: runtime,
    arch: fn.Architectures?.[0] ?? "x86_64",
    packages,
    services: [
      {
        name: fn.FunctionName ?? "unknown",
        serviceType: "appserver",
        version: fn.Version,
        status: fn.State ?? "unknown",
      },
    ],
    metadata: {
      functionArn: fn.FunctionArn,
      memorySize: fn.MemorySize,
      timeout: fn.Timeout,
      handler: fn.Handler,
      codeSize: fn.CodeSize,
      lastModified: fn.LastModified,
    },
  };
}

export function ecsContainerImagesToPackages(
  images: string[]
): PackageInfo[] {
  const refs = images.map(parseImageRef);
  return imagesToPackages(refs);
}

// ─── Retry helper ───

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 3
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const isThrottle =
        err instanceof Error &&
        ("name" in err &&
          (err.name === "Throttling" ||
            err.name === "ThrottlingException" ||
            err.name === "TooManyRequestsException"));

      if (!isThrottle || attempt === maxRetries) {
        throw err;
      }

      const delay = Math.min(1000 * 2 ** attempt + Math.random() * 500, 30000);
      console.warn(
        `[aws-scanner] Throttled on "${label}", retry ${attempt + 1}/${maxRetries} in ${Math.round(delay)}ms`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ─── Scanner ───

export class AwsScanner extends BaseScanner {
  async scan(config: ScanTargetConfig): Promise<ScanResult> {
    const connConfig =
      config.connectionConfig as unknown as AwsConnectionConfig;
    const regions = connConfig.regions?.length
      ? connConfig.regions
      : [connConfig.region];

    const allHosts: HostInventory[] = [];

    for (const region of regions) {
      try {
        const regionHosts = await this.scanRegion(region, connConfig);
        allHosts.push(...regionHosts);
      } catch (err) {
        console.warn(
          `[aws-scanner] Failed to scan region "${region}":`,
          err
        );
        // Continue with other regions
      }
    }

    return { hosts: allHosts };
  }

  private buildCredentials(config: AwsConnectionConfig) {
    if (config.accessKeyId && config.secretAccessKey) {
      return {
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      };
    }
    // Fall back to default credential chain (env vars, profile, IAM role, etc.)
    return {};
  }

  private async scanRegion(
    region: string,
    config: AwsConnectionConfig
  ): Promise<HostInventory[]> {
    const credentialOpts = this.buildCredentials(config);
    const hosts: HostInventory[] = [];

    // Run all resource scans concurrently for the region
    const [ec2Hosts, rdsHosts, ecsHosts, lambdaHosts] =
      await Promise.allSettled([
        this.scanEc2(region, credentialOpts),
        this.scanRds(region, credentialOpts),
        this.scanEcs(region, credentialOpts),
        this.scanLambda(region, credentialOpts),
      ]);

    for (const result of [ec2Hosts, rdsHosts, ecsHosts, lambdaHosts]) {
      if (result.status === "fulfilled") {
        hosts.push(...result.value);
      } else {
        console.warn(
          `[aws-scanner] Partial failure in region "${region}":`,
          result.reason
        );
      }
    }

    return hosts;
  }

  // ─── EC2 ───

  private async scanEc2(
    region: string,
    credentialOpts: object
  ): Promise<HostInventory[]> {
    const client = new EC2Client({ region, ...credentialOpts });
    const hosts: HostInventory[] = [];

    let nextToken: string | undefined;
    const allInstances: Instance[] = [];

    do {
      const resp = await withRetry(
        () =>
          client.send(
            new DescribeInstancesCommand({ NextToken: nextToken })
          ),
        `ec2:DescribeInstances:${region}`
      );

      for (const reservation of resp.Reservations ?? []) {
        allInstances.push(...(reservation.Instances ?? []));
      }
      nextToken = resp.NextToken;
    } while (nextToken);

    // Batch-fetch AMI descriptions for all unique AMI IDs
    const amiIds = [
      ...new Set(
        allInstances
          .map((i) => i.ImageId)
          .filter((id): id is string => !!id)
      ),
    ];

    const amiDescriptions = new Map<string, string>();
    if (amiIds.length > 0) {
      try {
        const amiResp = await withRetry(
          () =>
            client.send(
              new DescribeImagesCommand({ ImageIds: amiIds })
            ),
          `ec2:DescribeImages:${region}`
        );
        for (const img of amiResp.Images ?? []) {
          if (img.ImageId) {
            amiDescriptions.set(
              img.ImageId,
              img.Description ?? img.Name ?? img.ImageId
            );
          }
        }
      } catch (err) {
        console.warn(
          `[aws-scanner] Failed to describe AMIs in ${region}:`,
          err
        );
      }
    }

    for (const instance of allInstances) {
      // Skip terminated instances
      if (instance.State?.Name === "terminated") continue;

      const amiDesc = instance.ImageId
        ? amiDescriptions.get(instance.ImageId)
        : undefined;

      hosts.push(ec2InstanceToHost(instance, amiDesc));
    }

    return hosts;
  }

  // ─── RDS ───

  private async scanRds(
    region: string,
    credentialOpts: object
  ): Promise<HostInventory[]> {
    const client = new RDSClient({ region, ...credentialOpts });
    const hosts: HostInventory[] = [];

    let marker: string | undefined;
    do {
      const resp = await withRetry(
        () =>
          client.send(
            new DescribeDBInstancesCommand({ Marker: marker })
          ),
        `rds:DescribeDBInstances:${region}`
      );

      for (const db of resp.DBInstances ?? []) {
        hosts.push(rdsInstanceToHost(db));
      }
      marker = resp.Marker;
    } while (marker);

    return hosts;
  }

  // ─── ECS ───

  private async scanEcs(
    region: string,
    credentialOpts: object
  ): Promise<HostInventory[]> {
    const client = new ECSClient({ region, ...credentialOpts });
    const hosts: HostInventory[] = [];

    // List all clusters
    let clusterNextToken: string | undefined;
    const clusterArns: string[] = [];

    do {
      const resp = await withRetry(
        () =>
          client.send(
            new ListClustersCommand({ nextToken: clusterNextToken })
          ),
        `ecs:ListClusters:${region}`
      );
      clusterArns.push(...(resp.clusterArns ?? []));
      clusterNextToken = resp.nextToken;
    } while (clusterNextToken);

    // For each cluster, list and describe services
    for (const clusterArn of clusterArns) {
      try {
        let serviceNextToken: string | undefined;
        const serviceArns: string[] = [];

        do {
          const resp = await withRetry(
            () =>
              client.send(
                new ListServicesCommand({
                  cluster: clusterArn,
                  nextToken: serviceNextToken,
                })
              ),
            `ecs:ListServices:${clusterArn}`
          );
          serviceArns.push(...(resp.serviceArns ?? []));
          serviceNextToken = resp.nextToken;
        } while (serviceNextToken);

        if (serviceArns.length === 0) continue;

        // DescribeServices supports max 10 at a time
        for (let i = 0; i < serviceArns.length; i += 10) {
          const batch = serviceArns.slice(i, i + 10);
          const resp = await withRetry(
            () =>
              client.send(
                new DescribeServicesCommand({
                  cluster: clusterArn,
                  services: batch,
                })
              ),
            `ecs:DescribeServices:${clusterArn}`
          );

          for (const svc of resp.services ?? []) {
            const svcHost = await this.ecsServiceToHost(
              client,
              clusterArn,
              svc
            );
            if (svcHost) hosts.push(svcHost);
          }
        }
      } catch (err) {
        console.warn(
          `[aws-scanner] Failed to scan ECS cluster "${clusterArn}":`,
          err
        );
      }
    }

    return hosts;
  }

  private async ecsServiceToHost(
    client: ECSClient,
    clusterArn: string,
    svc: EcsService
  ): Promise<HostInventory | null> {
    const taskDef = svc.taskDefinition;
    if (!taskDef) return null;

    let images: string[] = [];
    try {
      const tdResp = await withRetry(
        () =>
          client.send(
            new DescribeTaskDefinitionCommand({ taskDefinition: taskDef })
          ),
        `ecs:DescribeTaskDefinition:${taskDef}`
      );

      images = (tdResp.taskDefinition?.containerDefinitions ?? [])
        .map((cd) => cd.image)
        .filter((img): img is string => !!img);
    } catch (err) {
      console.warn(
        `[aws-scanner] Failed to describe task definition "${taskDef}":`,
        err
      );
    }

    const clusterName =
      clusterArn.split("/").pop() ?? clusterArn;
    const serviceName = svc.serviceName ?? "unknown";

    return {
      hostname: `${clusterName}/${serviceName}`,
      ip: "",
      os: "aws-ecs",
      osVersion: "",
      arch: "",
      packages: ecsContainerImagesToPackages(images),
      services: [
        {
          name: serviceName,
          serviceType: "appserver",
          status: svc.status ?? "unknown",
        },
      ],
      metadata: {
        clusterArn,
        serviceArn: svc.serviceArn,
        taskDefinition: taskDef,
        desiredCount: svc.desiredCount,
        runningCount: svc.runningCount,
        launchType: svc.launchType,
      },
    };
  }

  // ─── Lambda ───

  private async scanLambda(
    region: string,
    credentialOpts: object
  ): Promise<HostInventory[]> {
    const client = new LambdaClient({ region, ...credentialOpts });
    const hosts: HostInventory[] = [];

    let marker: string | undefined;
    do {
      const resp = await withRetry(
        () =>
          client.send(new ListFunctionsCommand({ Marker: marker })),
        `lambda:ListFunctions:${region}`
      );

      for (const fn of resp.Functions ?? []) {
        hosts.push(lambdaFunctionToHost(fn));
      }
      marker = resp.NextMarker;
    } while (marker);

    return hosts;
  }
}
