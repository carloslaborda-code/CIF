export function getMinMax(data: number[][], attribute: number): {min: number; max: number} {
    let min = Infinity; 
    let max = -Infinity; 
    
    for (const dataInstance of data) { 
        const value = dataInstance[attribute]; 
        if (value < min) min = value; 
        if (value > max) max = value; 
    }

    return {min, max};
}

export function harmonic(n: number): number {
    let h = 0;

    for (let i = 1; i <= n; i++) {
        h += 1 / i;
    }

    return h;
}

export function c(n: number): number {
    if (n <= 1) return 0;
    if (n === 2) return 1;

    // const h = harmonic(n - 1);
    // return 2 * h - (2 * (n - 1)) / n;
    
    const gamma = 0.5772156649;
    return 2 * (Math.log(n - 1) + gamma) - (2 * (n - 1)) / n;
}

export function shuffle(dataSet: number[][]): number[][] { // Fisher–Yates shuffle
    const data = [...dataSet]; 
    
    for (let i = data.length - 1; i > 0; i--) { 
        const j = Math.floor(Math.random() * (i + 1)); 
        [data[i], data[j]] = [data[j], data[i]]; 
    }
    
    return data; 
}

export function sample(dataSet: number[][], subSamplingSize: number): number[][] {
    const shuffledDataSet = shuffle(dataSet);
    return shuffledDataSet.slice(0, subSamplingSize);
}

