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
} from "../scanners/kubernetes-scanner.js";

// ─── parseImageRef ───

describe("parseImageRef", () => {
  it("parses simple image:tag", () => {
    const result = parseImageRef("nginx:1.25.3");
    expect(result).toEqual({
      fullImage: "nginx:1.25.3",
      name: "nginx",
      tag: "1.25.3",
    });
  });

  it("defaults tag to 'latest' when missing", () => {
    const result = parseImageRef("redis");
    expect(result).toEqual({
      fullImage: "redis",
      name: "redis",
      tag: "latest",
    });
  });

  it("handles registry with port and tag", () => {
    const result = parseImageRef("registry.example.com:5000/myapp:v2.1");
    expect(result).toEqual({
      fullImage: "registry.example.com:5000/myapp:v2.1",
      name: "registry.example.com:5000/myapp",
      tag: "v2.1",
    });
  });

  it("handles registry with port and no tag", () => {
    const result = parseImageRef("registry.example.com:5000/myapp");
    expect(result).toEqual({
      fullImage: "registry.example.com:5000/myapp",
      name: "registry.example.com:5000/myapp",
      tag: "latest",
    });
  });

  it("handles full GCR path", () => {
    const result = parseImageRef("gcr.io/my-project/my-image:latest");
    expect(result).toEqual({
      fullImage: "gcr.io/my-project/my-image:latest",
      name: "gcr.io/my-project/my-image",
      tag: "latest",
    });
  });

  it("handles digest reference", () => {
    const result = parseImageRef(
      "nginx@sha256:abc123def456"
    );
    expect(result).toEqual({
      fullImage: "nginx@sha256:abc123def456",
      name: "nginx",
      tag: "sha256:abc123def456",
    });
  });

  it("handles ECR-style images", () => {
    const result = parseImageRef(
      "123456789.dkr.ecr.us-east-1.amazonaws.com/my-app:build-42"
    );
    expect(result).toEqual({
      fullImage:
        "123456789.dkr.ecr.us-east-1.amazonaws.com/my-app:build-42",
      name: "123456789.dkr.ecr.us-east-1.amazonaws.com/my-app",
      tag: "build-42",
    });
  });
});

// ─── imagesToPackages ───

describe("imagesToPackages", () => {
  it("converts images to PackageInfo entries", () => {
    const images = [
      { fullImage: "nginx:1.25", name: "nginx", tag: "1.25" },
      { fullImage: "redis:7.2", name: "redis", tag: "7.2" },
    ];
    const result = imagesToPackages(images);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: "nginx",
      installedVersion: "1.25",
      packageManager: "docker",
      ecosystem: "docker",
    });
  });

  it("de-duplicates identical images", () => {
    const images = [
      { fullImage: "nginx:1.25", name: "nginx", tag: "1.25" },
      { fullImage: "nginx:1.25", name: "nginx", tag: "1.25" },
      { fullImage: "nginx:1.24", name: "nginx", tag: "1.24" },
    ];
    const result = imagesToPackages(images);
    expect(result).toHaveLength(2);
  });

  it("returns empty for no images", () => {
    expect(imagesToPackages([])).toHaveLength(0);
  });
});

// ─── k8sServiceToServiceInfo ───

describe("k8sServiceToServiceInfo", () => {
  it("converts LoadBalancer service", () => {
    const svc: K8sServiceSummary = {
      name: "web-svc",
      namespace: "production",
      type: "LoadBalancer",
      ports: [{ port: 80, targetPort: 8080, protocol: "TCP" }],
      selectors: { app: "web" },
    };
    const result = k8sServiceToServiceInfo(svc);
    expect(result).toEqual({
      name: "production/web-svc",
      serviceType: "webserver",
      port: 80,
      status: "running",
    });
  });

  it("converts ClusterIP service", () => {
    const svc: K8sServiceSummary = {
      name: "backend",
      namespace: "default",
      type: "ClusterIP",
      ports: [{ port: 3000, targetPort: 3000, protocol: "TCP" }],
      selectors: { app: "backend" },
    };
    const result = k8sServiceToServiceInfo(svc);
    expect(result.serviceType).toBe("other");
    expect(result.port).toBe(3000);
  });

  it("converts NodePort service", () => {
    const svc: K8sServiceSummary = {
      name: "api",
      namespace: "staging",
      type: "NodePort",
      ports: [{ port: 443, targetPort: 8443, protocol: "TCP" }],
      selectors: {},
    };
    const result = k8sServiceToServiceInfo(svc);
    expect(result.serviceType).toBe("webserver");
  });

  it("handles service with no ports", () => {
    const svc: K8sServiceSummary = {
      name: "headless",
      namespace: "default",
      type: "ClusterIP",
      ports: [],
      selectors: {},
    };
    const result = k8sServiceToServiceInfo(svc);
    expect(result.port).toBeUndefined();
  });
});

// ─── k8sIngressToServiceInfo ───

describe("k8sIngressToServiceInfo", () => {
  it("converts ingress with hosts", () => {
    const ing: K8sIngressSummary = {
      name: "web-ingress",
      namespace: "production",
      hosts: ["app.example.com", "api.example.com"],
      paths: ["/", "/api"],
    };
    const result = k8sIngressToServiceInfo(ing);
    expect(result).toEqual({
      name: "production/web-ingress",
      serviceType: "webserver",
      version: "app.example.com, api.example.com",
      port: 443,
      status: "running",
    });
  });

  it("handles ingress with no hosts", () => {
    const ing: K8sIngressSummary = {
      name: "default-ingress",
      namespace: "default",
      hosts: [],
      paths: ["/"],
    };
    const result = k8sIngressToServiceInfo(ing);
    expect(result.version).toBe("");
  });
});
