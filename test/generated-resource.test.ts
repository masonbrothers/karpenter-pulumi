import * as pulumi from "@pulumi/pulumi";
import { NodePool } from "../karpenter/v1/nodePool";
import { describe, expect, it } from "vitest";

pulumi.runtime.setMocks(
  {
    call: (args) => args.inputs,
    newResource: (args) => ({
      id: `${args.name}_id`,
      state: args.inputs,
    }),
  },
  "project",
  "stack",
  false,
);

describe("generated Karpenter CRD resources", () => {
  it("constructs a typed NodePool with generated API defaults", async () => {
    const nodePool = new NodePool("default", {
      metadata: {
        name: "default",
      },
      spec: {
        template: {
          spec: {
            nodeClassRef: {
              group: "karpenter.k8s.aws",
              kind: "EC2NodeClass",
              name: "default",
            },
            requirements: [],
          },
        },
      },
    });

    expect(NodePool.isInstance(nodePool)).toBe(true);
    expect(NodePool.__pulumiType).toBe("kubernetes:karpenter.sh/v1:NodePool");
    await expect(outputValue(nodePool.apiVersion)).resolves.toBe("karpenter.sh/v1");
    await expect(outputValue(nodePool.kind)).resolves.toBe("NodePool");
    await expect(outputValue(nodePool.metadata)).resolves.toMatchObject({
      name: "default",
    });
  });
});

async function outputValue<T>(output: pulumi.Output<T>): Promise<T> {
  return (output as unknown as { promise: () => Promise<T> }).promise();
}
