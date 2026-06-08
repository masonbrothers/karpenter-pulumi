const assert = require("node:assert/strict");
const pulumi = require("@pulumi/pulumi");
const karpenter = require("../dist/index.js");

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

async function main() {
  const nodePool = new karpenter.karpenter.v1.NodePool("default", {
    metadata: { name: "default" },
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

  assert.equal(karpenter.karpenter.v1.NodePool.isInstance(nodePool), true);
  assert.equal(await nodePool.apiVersion.promise(), "karpenter.sh/v1");
  assert.equal(await nodePool.kind.promise(), "NodePool");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
