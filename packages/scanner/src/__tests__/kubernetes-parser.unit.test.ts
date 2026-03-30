import { describe, it, expect } from "vitest";
import {
  parseImageRef,
  imagesToPackages,
  k8sServiceToServiceInfo,
  k8sIngressToServiceInfo,
} from "../scanners/kubernetes-scanner.js";
import type {
  K8sServiceSummary,
  K8sIngressSummary,
  ContainerImageRef,
} from "../scanners/kubernetes-scanner.js";

// ─── parseImageRef — additional edge cases ───

describe("parseImageRef — additional edge cases", () => {
  it("parses image with full registry path", () => {
    const result = parseImageRef("registry.example.com/team/app:v2.1.0");
    expect(result.name).toBe("registry.example.com/team/app");
    expect(result.tag).toBe("v2.1.0");
  });

  it("parses image with digest instead of tag", () => {
    const result = parseImageRef("nginx@sha256:abc123def456789");
    expect(result.name).toBe("nginx");
    expect(result.tag).toBe("sha256:abc123def456789");
  });

  it("parses full registry + digest", () => {
    const result = parseImageRef("gcr.io/project/image@sha256:abc123");
    expect(result.name).toBe("gcr.io/project/image");
    expect(result.tag).toBe("sha256:abc123");
  });

  it("handles empty string", () => {
    const result = parseImageRef("");
    expect(result.name).toBe("");
    expect(result.tag).toBe("latest");
  });

  it("handles deeply nested registry paths", () => {
    const result = parseImageRef("my-registry.io:5000/org/team/subteam/app:v3");
    expect(result.name).toBe("my-registry.io:5000/org/team/subteam/app");
    expect(result.tag).toBe("v3");
  });
});

// ─── imagesToPackages — deployment with multiple containers ───

describe("imagesToPackages — multiple containers", () => {
  it("handles deployment with multiple containers (sidecar pattern)", () => {
    const images: ContainerImageRef[] = [
      { fullImage: "myapp:v1.0", name: "myapp", tag: "v1.0" },
      { fullImage: "envoy:1.28", name: "envoy", tag: "1.28" },
      { fullImage: "fluentd:v1.16", name: "fluentd", tag: "v1.16" },
    ];
    const result = imagesToPackages(images);
    expect(result).toHaveLength(3);
    expect(result.map((p) => p.name)).toEqual(["myapp", "envoy", "fluentd"]);
  });

  it("handles init containers merged with regular containers", () => {
    const images: ContainerImageRef[] = [
      // Init container
      { fullImage: "busybox:1.36", name: "busybox", tag: "1.36" },
      // Regular containers
      { fullImage: "myapp:v1.0", name: "myapp", tag: "v1.0" },
      { fullImage: "envoy:1.28", name: "envoy", tag: "1.28" },
    ];
    const result = imagesToPackages(images);
    expect(result).toHaveLength(3);
  });

  it("deduplicates same image across init and regular containers", () => {
    const images: ContainerImageRef[] = [
      { fullImage: "myapp:v1.0", name: "myapp", tag: "v1.0" },
      { fullImage: "myapp:v1.0", name: "myapp", tag: "v1.0" }, // same in init
    ];
    const result = imagesToPackages(images);
    expect(result).toHaveLength(1);
  });
});

// ─── k8sServiceToServiceInfo — edge cases ───

describe("k8sServiceToServiceInfo — edge cases", () => {
  it("handles service with multiple ports (uses first)", () => {
    const svc: K8sServiceSummary = {
      name: "multi-port-svc",
      namespace: "default",
      type: "ClusterIP",
      ports: [
        { port: 80, targetPort: 8080, protocol: "TCP" },
        { port: 443, targetPort: 8443, protocol: "TCP" },
      ],
      selectors: { app: "web" },
    };
    const result = k8sServiceToServiceInfo(svc);
    expect(result.port).toBe(80);
  });
});

// ─── k8sIngressToServiceInfo — edge cases ───

describe("k8sIngressToServiceInfo — edge cases", () => {
  it("handles ingress with multiple hosts and paths", () => {
    const ing: K8sIngressSummary = {
      name: "multi-ingress",
      namespace: "production",
      hosts: ["app.example.com", "api.example.com", "admin.example.com"],
      paths: ["/", "/api", "/admin"],
    };
    const result = k8sIngressToServiceInfo(ing);
    expect(result.version).toBe("app.example.com, api.example.com, admin.example.com");
    expect(result.port).toBe(443);
    expect(result.serviceType).toBe("webserver");
  });
});
