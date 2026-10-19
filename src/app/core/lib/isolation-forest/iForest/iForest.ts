import { iTree } from "../iTree/iTree";
import { sample, c } from "../utils/math";

export class iForest {

    numTrees: number;
    subSamplingSize: number;
    treeEnsemble: iTree[] = [];
    heightLimit: number;

    constructor(numTrees: number = 100, subSamplingSize: number = 256) {
        if (numTrees <= 0) throw new Error("Number of trees must be greater than 0");
        if (subSamplingSize <= 0) throw new Error("Subsampling size must be greater than 0");
        
        this.numTrees = numTrees;
        this.subSamplingSize = subSamplingSize;
        this.heightLimit = Math.ceil(Math.log2(this.subSamplingSize));
    }

    fit(trainingData: number[][]) {
        if (trainingData.length === 0) throw new Error ("Training dataset cannot be empty");
        this.buildForest(trainingData);
    }

    private buildForest(trainingData: number[][]) {
        for (let i = 0; i < this.numTrees; i++) {
            const dataSubSample = sample(trainingData, this.subSamplingSize);
            const tree = new iTree(this.heightLimit);
            tree.train(dataSubSample);
            this.treeEnsemble.push(tree);
        }
    }

    calculateScores(dataSet: number[][]): number[] {
        return dataSet.map(dataInstance => this.score(dataInstance, this.subSamplingSize));
    }

    private score(dataInstance: number[], n: number): number {
        return Math.pow(2, - (this.averagePathLength(dataInstance) / c(n)) );
    }

    private averagePathLength(dataInstance: number[]): number { 
        let pathLengthSum = 0;
        for (const tree of this.treeEnsemble) {
            pathLengthSum += tree.pathLength(dataInstance);
        }
        return pathLengthSum / this.numTrees;
    }
}