export const NodeType = {
  External: "external",
  Internal: "internal"
} as const;

export type iTreeNode =
    | { 
        type: "external", 
        size: number }
    | {
        type: "internal",
        splitAttribute: number,
        splitValue: number,
        leftChild: iTreeNode,
        rightChild: iTreeNode,
    };
