import { iTreeNode, NodeType } from "../types/iTreeNode"
import { getMinMax, c } from "../utils/math";

export class iTree {

    rootNode: iTreeNode | null = null;
    heightLimit: number;

    constructor(heightLimit: number) {
        this.heightLimit = heightLimit;
    }

    train(trainingDataset: number[][]) {
        this.rootNode = this.buildTree(trainingDataset, 0);
    }

    private buildTree(trainingDataset: number[][], currentHeight: number): iTreeNode {
        if (trainingDataset.length === 0) {
            return this.createExternalNode(0);
        }

        if (currentHeight >= this.heightLimit || trainingDataset.length <= 1) { 
            return this.createExternalNode(trainingDataset.length); 
        } else {
            const totalNumAttributes = trainingDataset[0].length;
            const splitAttribute = Math.floor( Math.random() * totalNumAttributes);

            const {min, max} = getMinMax(trainingDataset, splitAttribute);
            if (min === max) { 
                return this.createExternalNode(trainingDataset.length); 
            }

            const splitValue = Math.random() * (max - min) + min;

            const leftSplitData = trainingDataset.filter(dataInstance => dataInstance[splitAttribute] < splitValue);
            const rightSplitData = trainingDataset.filter(dataInstance => dataInstance[splitAttribute] >= splitValue);
            
            return this.createInternalNode(leftSplitData, rightSplitData, currentHeight + 1, splitAttribute, splitValue);
        }
    }

    private createExternalNode(size: number): iTreeNode {
        return {
            type: NodeType.External,
            size: size,
        }
    }

    private createInternalNode(leftSplitData: number[][], rightSplitData: number[][], currentHeigth: number, splitAttribute: number, splitValue: number): iTreeNode { 
        return { 
            type: NodeType.Internal,
            splitAttribute: splitAttribute, 
            splitValue: splitValue, 
            leftChild: this.buildTree(leftSplitData, currentHeigth), 
            rightChild: this.buildTree(rightSplitData, currentHeigth), 
        }
    }

    pathLength(dataInstance: number[]): number {
        if (!this.rootNode) {
            throw new Error("Tree not trained");
        }
        return this.calculatePathLength(dataInstance, this.rootNode, 0);
    }

    private calculatePathLength(dataInstance: number[], actualNode: iTreeNode, currentPathLength: number = 0): number {
        if (actualNode.type === NodeType.External) {
            return currentPathLength + c(actualNode.size);
        }

        if (dataInstance[actualNode.splitAttribute] < actualNode.splitValue) {
            return this.calculatePathLength(dataInstance, actualNode.leftChild, currentPathLength + 1);
        } else {
            return this.calculatePathLength(dataInstance, actualNode.rightChild, currentPathLength + 1);
        }
    }
}