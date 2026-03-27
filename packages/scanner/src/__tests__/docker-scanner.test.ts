import { describe, it, expect } from "vitest";
import {
  normalizeContainer,
  containersToPackages,
  containersToServices,
  buildHostInventory,
} from "../scanners/docker-scanner.js";
import type { DockerContainerSummary, DockerHostInfo } from "../scanners/docker-scanner.js";
import type { ContainerInfo } from "dockerode";

// ─── normalizeContainer ───

describe("normalizeContainer", () => {
  it("normalizes a running container with ports", () => {
    const c = {
      Id: "abc123def456",
      Names: ["/my-nginx"],
      Image: "nginx:1.25-alpine",
      State: "running",
      Status: "Up 3 hours",
      Ports: [
        { PrivatePort: 80, PublicPort: 8080, Type: "tcp" },
        { PrivatePort: 443, Type: "tcp" },
      ],
      Created: 1700000000,
    } as unknown as ContainerInfo;

    const result = normalizeContainer(c);
    expect(result.id).toBe("abc123def456");
    expect(result.name).toBe("my-nginx");
    expect(result.image).toBe("nginx");
    expect(result.imageTag).toBe("1.25-alpine");
    expect(result.state).toBe("running");
    expect(result.ports).toHaveLength(2);
    expect(result.ports[0]).toEqual({
      hostPort: 8080,
      containerPort: 80,
      protocol: "tcp",
    });
    expect(result.ports[1].hostPort).toBeUndefined();
  });

  it("handles image with no tag (defaults to latest)", () => {
    const c = {
      Id: "def456",
      Names: ["/redis-cache"],
      Image: "redis",
      State: "running",
      Status: "Up 1 hour",
      Ports: [],
      Created: 1700000000,
    } as unknown as ContainerInfo;

    const result = normalizeContainer(c);
    expect(result.image).toBe("redis");
    expect(result.imageTag).toBe("latest");
  });

  it("handles registry with port in image name", () => {
    const c = {
      Id: "ghi789",
      Names: ["/my-app"],
      Image: "registry.local:5000/my-app:v2.3",
      State: "running",
      Status: "Up",
      Ports: [],
      Created: 1700000000,
    } as unknown as ContainerInfo;

    const result = normalizeContainer(c);
    expect(result.image).toBe("registry.local:5000/my-app");
    expect(result.imageTag).toBe("v2.3");
  });

  it("handles digest-based image reference", () => {
    const c = {
      Id: "xyz000",
      Names: ["/pinned"],
      Image: "nginx@sha256:abc123",
      State: "running",
      Status: "Up",
      Ports: [],
      Created: 1700000000,
    } as unknown as ContainerInfo;

    const result = normalizeContainer(c);
    expect(result.image).toBe("nginx");
    expect(result.imageTag).toBe("sha256:abc123");
  });

  it("falls back to truncated ID when no name", () => {
    const c = {
      Id: "abc123def456789",
      Names: [],
      Image: "busybox",
      State: "exited",
      Status: "Exited (0)",
      Ports: [],
      Created: 1700000000,
    } as unknown as ContainerInfo;

    const result = normalizeContainer(c);
    expect(result.name).toBe("abc123def456");
  });
});

// ─── containersToPackages ───

describe("containersToPackages", () => {
  const containers: DockerContainerSummary[] = [
    {
      id: "a",
      name: "web",
      image: "nginx",
      imageTag: "1.25",
      state: "running",
      status: "Up",
      ports: [],
      created: "",
    },
    {
      id: "b",
      name: "cache",
      image: "redis",
      imageTag: "7.2",
      state: "running",
      status: "Up",
      ports: [],
      created: "",
    },
    {
      id: "c",
      name: "web2",
      image: "nginx",
      imageTag: "1.25",
      state: "running",
      status: "Up",
      ports: [],
      created: "",
    },
  ];

  it("de-duplicates images", () => {
    const result = containersToPackages(containers);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: "nginx",
      installedVersion: "1.25",
      packageManager: "docker",
      ecosystem: "docker",
    });
  });

  it("returns empty for no containers", () => {
    expect(containersToPackages([])).toHaveLength(0);
  });
});

// ─── containersToServices ───

describe("containersToServices", () => {
  it("only includes running containers", () => {
    const containers: DockerContainerSummary[] = [
      {
        id: "a",
        name: "web",
        image: "nginx",
        imageTag: "1.25",
        state: "running",
        status: "Up 3h",
        ports: [{ hostPort: 8080, containerPort: 80, protocol: "tcp" }],
        created: "",
      },
      {
        id: "b",
        name: "old-app",
        image: "myapp",
        imageTag: "1.0",
        state: "exited",
        status: "Exited (0)",
        ports: [],
        created: "",
      },
    ];

    const result = containersToServices(containers);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "web",
      serviceType: "container-runtime",
      version: "nginx:1.25",
      port: 8080,
      status: "running",
    });
  });

  it("handles container with no host port", () => {
    const containers: DockerContainerSummary[] = [
      {
        id: "a",
        name: "internal",
        image: "redis",
        imageTag: "7.0",
        state: "running",
        status: "Up",
        ports: [{ containerPort: 6379, protocol: "tcp" }],
        created: "",
      },
    ];

    const result = containersToServices(containers);
    expect(result[0].port).toBeUndefined();
  });
});

// ─── buildHostInventory ───

describe("buildHostInventory", () => {
  const hostInfo: DockerHostInfo = {
    os: "Ubuntu 22.04.3 LTS",
    kernelVersion: "5.15.0-91-generic",
    totalMemory: 16777216000,
    cpus: 8,
    dockerVersion: "24.0.7",
    totalContainers: 5,
    runningContainers: 3,
    images: 12,
  };

  const containers: DockerContainerSummary[] = [
    {
      id: "a",
      name: "web",
      image: "nginx",
      imageTag: "1.25",
      state: "running",
      status: "Up",
      ports: [{ hostPort: 80, containerPort: 80, protocol: "tcp" }],
      created: "2024-01-01T00:00:00Z",
    },
    {
      id: "b",
      name: "db",
      image: "postgres",
      imageTag: "16",
      state: "running",
      status: "Up",
      ports: [{ hostPort: 5432, containerPort: 5432, protocol: "tcp" }],
      created: "2024-01-01T00:00:00Z",
    },
  ];

  it("builds complete host inventory", () => {
    const result = buildHostInventory("docker-prod-01", hostInfo, containers);

    expect(result.hostname).toBe("docker-prod-01");
    expect(result.os).toBe("Ubuntu 22.04.3 LTS");
    expect(result.osVersion).toBe("5.15.0-91-generic");

    // docker-engine + 2 unique images
    expect(result.packages).toHaveLength(3);
    expect(result.packages[0]).toEqual({
      name: "docker-engine",
      installedVersion: "24.0.7",
      packageManager: "docker",
      ecosystem: "docker",
    });

    // 2 running containers
    expect(result.services).toHaveLength(2);

    expect(result.metadata.dockerVersion).toBe("24.0.7");
    expect(result.metadata.totalContainers).toBe(5);
    expect(result.metadata.runningContainers).toBe(3);
    expect(result.metadata.images).toBe(12);
    expect(result.metadata.totalMemoryMB).toBe(16000);
    expect(result.metadata.cpus).toBe(8);
  });

  it("works with no containers", () => {
    const result = buildHostInventory("empty-host", hostInfo, []);
    // Only docker-engine package
    expect(result.packages).toHaveLength(1);
    expect(result.services).toHaveLength(0);
  });
});
