export const defaultKarpenterVersion = "1.12.1";
export const defaultKarpenterNamespace = "kube-system";
export const defaultKarpenterServiceAccountName = "karpenter";

export const defaultControllerPolicyNames = [
  "KarpenterControllerNodeLifecyclePolicy",
  "KarpenterControllerIAMIntegrationPolicy",
  "KarpenterControllerEKSIntegrationPolicy",
  "KarpenterControllerInterruptionPolicy",
  "KarpenterControllerResourceDiscoveryPolicy",
  "KarpenterControllerZonalShiftPolicy",
] as const;
