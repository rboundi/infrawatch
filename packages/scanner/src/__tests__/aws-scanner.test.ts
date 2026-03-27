import { describe, it, expect } from "vitest";
import {
  ec2InstanceToHost,
  rdsInstanceToHost,
  lambdaFunctionToHost,
  ecsContainerImagesToPackages,
} from "../scanners/aws-scanner.js";

// ─── ec2InstanceToHost ───

describe("ec2InstanceToHost", () => {
  it("converts a typical EC2 instance with Name tag", () => {
    const instance = {
      InstanceId: "i-0123456789abcdef0",
      InstanceType: "t3.medium",
      PrivateIpAddress: "10.0.1.42",
      Platform: undefined, // Linux has no platform field
      Architecture: "x86_64",
      ImageId: "ami-0abcdef1234567890",
      State: { Name: "running" },
      Placement: { AvailabilityZone: "us-east-1a" },
      VpcId: "vpc-abc123",
      SecurityGroups: [
        { GroupId: "sg-111", GroupName: "web-sg" },
        { GroupId: "sg-222", GroupName: "ssh-sg" },
      ],
      LaunchTime: new Date("2024-01-15T10:30:00Z"),
      Tags: [
        { Key: "Name", Value: "web-server-01" },
        { Key: "Environment", Value: "production" },
      ],
    };

    const result = ec2InstanceToHost(
      instance as any,
      "Ubuntu 22.04 LTS (HVM), SSD Volume Type"
    );

    expect(result.hostname).toBe("web-server-01");
    expect(result.ip).toBe("10.0.1.42");
    expect(result.os).toBe("linux");
    expect(result.osVersion).toBe("Ubuntu 22.04 LTS (HVM), SSD Volume Type");
    expect(result.arch).toBe("x86_64");
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]).toEqual({
      name: "ami-0abcdef1234567890",
      installedVersion: "Ubuntu 22.04 LTS (HVM), SSD Volume Type",
      packageManager: "ami",
      ecosystem: "aws",
    });
    expect(result.metadata.instanceId).toBe("i-0123456789abcdef0");
    expect(result.metadata.instanceType).toBe("t3.medium");
    expect(result.metadata.state).toBe("running");
    expect(result.metadata.securityGroups).toHaveLength(2);
  });

  it("falls back to instance ID when no Name tag", () => {
    const instance = {
      InstanceId: "i-abcdef",
      Tags: [],
    };
    const result = ec2InstanceToHost(instance as any);
    expect(result.hostname).toBe("i-abcdef");
  });

  it("handles Windows platform", () => {
    const instance = {
      InstanceId: "i-win123",
      Platform: "windows",
      Tags: [{ Key: "Name", Value: "win-server" }],
    };
    const result = ec2InstanceToHost(instance as any);
    expect(result.os).toBe("windows");
  });

  it("handles missing optional fields gracefully", () => {
    const instance = {
      InstanceId: "i-minimal",
    };
    const result = ec2InstanceToHost(instance as any);
    expect(result.hostname).toBe("i-minimal");
    expect(result.ip).toBe("");
    expect(result.os).toBe("linux");
    expect(result.arch).toBe("x86_64");
    expect(result.packages).toHaveLength(0);
  });
});

// ─── rdsInstanceToHost ───

describe("rdsInstanceToHost", () => {
  it("converts a PostgreSQL RDS instance", () => {
    const db = {
      DBInstanceIdentifier: "prod-postgres",
      Engine: "postgres",
      EngineVersion: "16.1",
      DBInstanceClass: "db.r6g.xlarge",
      MultiAZ: true,
      StorageType: "gp3",
      AllocatedStorage: 100,
      Endpoint: { Address: "prod-postgres.abc.us-east-1.rds.amazonaws.com", Port: 5432 },
      DBInstanceStatus: "available",
    };

    const result = rdsInstanceToHost(db as any);
    expect(result.hostname).toBe("prod-postgres");
    expect(result.os).toBe("postgres");
    expect(result.osVersion).toBe("16.1");
    expect(result.ip).toBe("prod-postgres.abc.us-east-1.rds.amazonaws.com");
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]).toEqual({
      name: "postgres",
      installedVersion: "16.1",
      packageManager: "rds",
      ecosystem: "aws",
    });
    expect(result.services).toHaveLength(1);
    expect(result.services[0]).toEqual({
      name: "prod-postgres",
      serviceType: "database",
      version: "16.1",
      port: 5432,
      status: "available",
    });
    expect(result.metadata.instanceClass).toBe("db.r6g.xlarge");
    expect(result.metadata.multiAz).toBe(true);
  });

  it("converts a MySQL RDS instance", () => {
    const db = {
      DBInstanceIdentifier: "staging-mysql",
      Engine: "mysql",
      EngineVersion: "8.0.35",
      DBInstanceClass: "db.t3.medium",
      MultiAZ: false,
      StorageType: "gp2",
      AllocatedStorage: 50,
      Endpoint: { Address: "staging-mysql.abc.rds.amazonaws.com", Port: 3306 },
      DBInstanceStatus: "available",
    };

    const result = rdsInstanceToHost(db as any);
    expect(result.os).toBe("mysql");
    expect(result.osVersion).toBe("8.0.35");
    expect(result.services[0].port).toBe(3306);
  });

  it("handles missing endpoint", () => {
    const db = {
      DBInstanceIdentifier: "creating-db",
      Engine: "postgres",
      EngineVersion: "15.4",
      DBInstanceStatus: "creating",
    };

    const result = rdsInstanceToHost(db as any);
    expect(result.ip).toBe("");
    expect(result.services[0].status).toBe("creating");
  });
});

// ─── lambdaFunctionToHost ───

describe("lambdaFunctionToHost", () => {
  it("converts a Node.js Lambda function", () => {
    const fn = {
      FunctionName: "api-handler",
      FunctionArn: "arn:aws:lambda:us-east-1:123456:function:api-handler",
      Runtime: "nodejs20.x",
      Version: "$LATEST",
      State: "Active",
      Architectures: ["arm64"],
      MemorySize: 256,
      Timeout: 30,
      Handler: "index.handler",
      CodeSize: 1048576,
      LastModified: "2024-01-20T15:00:00Z",
      Layers: [
        {
          Arn: "arn:aws:lambda:us-east-1:123456:layer:my-layer:3",
        },
      ],
    };

    const result = lambdaFunctionToHost(fn as any);
    expect(result.hostname).toBe("api-handler");
    expect(result.os).toBe("aws-lambda");
    expect(result.osVersion).toBe("nodejs20.x");
    expect(result.arch).toBe("arm64");
    expect(result.packages).toHaveLength(2);
    expect(result.packages[0]).toEqual({
      name: "nodejs20.x",
      installedVersion: "nodejs20.x",
      packageManager: "lambda",
      ecosystem: "aws",
    });
    expect(result.packages[1]).toEqual({
      name: "my-layer",
      installedVersion: "3",
      packageManager: "lambda-layer",
      ecosystem: "aws",
    });
    expect(result.services).toHaveLength(1);
    expect(result.services[0].status).toBe("Active");
    expect(result.metadata.memorySize).toBe(256);
  });

  it("converts a Python Lambda function with no layers", () => {
    const fn = {
      FunctionName: "data-processor",
      Runtime: "python3.12",
      State: "Active",
      Version: "$LATEST",
    };

    const result = lambdaFunctionToHost(fn as any);
    expect(result.osVersion).toBe("python3.12");
    expect(result.packages).toHaveLength(1);
    expect(result.arch).toBe("x86_64"); // default
  });

  it("handles missing optional fields", () => {
    const fn = {
      FunctionName: "minimal-fn",
    };

    const result = lambdaFunctionToHost(fn as any);
    expect(result.hostname).toBe("minimal-fn");
    expect(result.osVersion).toBe("unknown");
    expect(result.packages[0].name).toBe("unknown");
  });
});

// ─── ecsContainerImagesToPackages ───

describe("ecsContainerImagesToPackages", () => {
  it("converts container image strings to packages", () => {
    const images = [
      "nginx:1.25",
      "redis:7.2-alpine",
      "123456.dkr.ecr.us-east-1.amazonaws.com/my-app:build-42",
    ];
    const result = ecsContainerImagesToPackages(images);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      name: "nginx",
      installedVersion: "1.25",
      packageManager: "docker",
      ecosystem: "docker",
    });
    expect(result[1].installedVersion).toBe("7.2-alpine");
    expect(result[2].name).toBe(
      "123456.dkr.ecr.us-east-1.amazonaws.com/my-app"
    );
  });

  it("de-duplicates identical images", () => {
    const images = ["nginx:1.25", "nginx:1.25", "redis:7.0"];
    const result = ecsContainerImagesToPackages(images);
    expect(result).toHaveLength(2);
  });

  it("returns empty for no images", () => {
    expect(ecsContainerImagesToPackages([])).toHaveLength(0);
  });
});
