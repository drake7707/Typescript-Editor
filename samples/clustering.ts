class Particle implements IComparable {
    x: number;
    y: number;

    element: HTMLCanvasElement;
    r: number;
    g: number;
    b: number;

    public updateElement(): void {
        var style: string = "";
        style += "left: " + Math.floor(this.x) + "px;";
        style += "top: " + Math.floor(this.y) + "px;";

        style += "background-color:rgb("
        style += Math.floor(this.r) + ",";
        style += Math.floor(this.g) + ",";
        style += Math.floor(this.b) + ");";

        this.element.setAttribute("style", style);
    }


    public static getHue(red: number, green: number, blue: number): number {

        var min: number = Math.min(Math.min(red, green), blue);
        var max: number = Math.max(Math.max(red, green), blue);

        var hue: number = 0;
        if (max == red) {
            hue = (green - blue) / (max - min);

        } else if (max == green) {
            hue = 2 + (blue - red) / (max - min);

        } else {
            hue = 4 + (red - green) / (max - min);
        }

        hue = hue * 60;
        if (hue < 0) hue = hue + 360;

        return Math.round(hue);
    }

    public difference(p: Particle): number {
        /*return Math.sqrt(
            Math.abs(this.r - p.r) * Math.abs(this.r - p.r) +
            Math.abs(this.g - p.g) * Math.abs(this.g - p.g) +
            Math.abs(this.b - p.b) * Math.abs(this.b - p.b)
        );*/
        return Math.abs(Particle.getHue(this.r, this.g, this.b) -
            Particle.getHue(p.r, p.g, p.b));
    }

    public compareTo(other: IComparable): number {
        var diff: number = this.difference(<Particle>other);
        if (diff == 0)
            return 0;
        else if (diff < 0)
            return -1;
        else
            return 1.
    }

}

class ParticleManager {
    particles: Particle[];
    private container: HTMLDivElement;
    constructor(container: HTMLDivElement) {
        this.container = container;
        this.particles = [];
    }

    SIZE: number = 10;

    public createParticles(n: number) {
        var w: number = $(this.container).width();
        var h: number = $(this.container).height();

        for (var i: number = 0; i < n; i++) {
            var p: Particle = new Particle();
            p.x = Math.random() * w;
            p.y = Math.random() * h;
            p.r = Math.random() * 255;
            p.g = Math.random() * 255;
            p.b = Math.random() * 255;
            var el: any = $("<div class='particle'>" + i + "</div>");
            $(this.container).append(el);
            p.element = el.get(0);
            p.updateElement();

            this.particles.push(p);
        }
    }

    public moveParticlesToClusterCenter(clusters: number[][], c: number) {
        if (c >= 0 && clusters[c].length > 1) {
            console.log("Cluster " + c + "moving");
            console.log(clusters[c]);

            var sumX: number = 0;
            var sumY: number = 0;
            clusters[c].forEach(i => {
                sumX += this.particles[i].x;
                sumY += this.particles[i].y
            });
            var centerX: number = sumX / clusters[c].length;
            var centerY: number = sumY / clusters[c].length;

            var cols = Math.floor(Math.sqrt(clusters[c].length));
            var rows = cols;

            var offsetX: number = centerX - this.SIZE * cols / 2;
            var offsetY: number = centerY - this.SIZE * rows / 2;

            for (var i: number = 0; i < clusters[c].length; i++) {
                var x: number = offsetX + this.SIZE * (i % cols);
                var y: number = offsetY + this.SIZE * (i / cols);

                var pIdx: number = clusters[c][i];
                this.particles[pIdx].x = x;
                this.particles[pIdx].y = y;
                this.particles[pIdx].updateElement();
            }
        }
    }
}

class Link implements IComparable {
    from: number;
    to: number;
    weight: number;

    constructor(from: number, to: number, weight: number) {
        this.from = from;
        this.to = to;
        this.weight = weight;
    }

    public compareTo(other: IComparable): number {
        if (this.weight == (<Link>other).weight)
            return 0;
        else if (this.weight < (<Link>other).weight)
            return -1;
        else
            return 1;
    }
}

class KruskalClustering {

    private element_cluster: number[];
    clusters: number[][];
    private array: PriorityQueue<Link>;

    constructor(particles: Particle[]) {
        this.array = new PriorityQueue<Link>();
        this.element_cluster = [];
        this.clusters = [];

        for (var j: number = 0; j < particles.length; j++) {
            for (var i: number = j + 1; i < particles.length; i++) {
                this.array.enqueue(new Link(i, j, particles[i].difference(particles[j])));
            }
        }

        /*
        for (var j: number = 0; j < particles.length; j++) {
            for (var i: number = j + 1; i < particles.length; i++) {
                this.array.push(new Link(i, j, particles[i].difference(particles[j])));
            }
        }
        this.array.sort((a, b) => a.weight - b.weight);
        */
        for (var i: number = 0; i < particles.length; i++) {
            this.element_cluster.push(i);
            this.clusters.push([i]);
        }

    }

    isDone(): boolean {
        return this.array.size() == 0;
    }
    step() {
        var stop: boolean = false;
        while (!this.isDone() && !stop) {


            var l: Link = <Link>this.array.dequeue();

            var fromCluster: number = this.element_cluster[l.from];
            var toCluster: number = this.element_cluster[l.to];
            if (fromCluster != toCluster) {

                var clusterNr: number;
                if (this.clusters[fromCluster].length < this.clusters[toCluster].length) {
                    for (var i: number = 0; i < this.clusters[fromCluster].length; i++) {
                        var pIdx: number = this.clusters[fromCluster][i];
                        this.clusters[toCluster].push(pIdx);
                        this.element_cluster[pIdx] = toCluster;
                    }
                    this.clusters[fromCluster] = [];
                    clusterNr = toCluster;
                }
                else {
                    for (var i: number = 0; i < this.clusters[toCluster].length; i++) {
                        var pIdx: number = this.clusters[toCluster][i];
                        this.clusters[fromCluster].push(pIdx);
                        this.element_cluster[pIdx] = fromCluster;
                    }
                    this.clusters[toCluster] = [];
                    clusterNr = fromCluster;
                }

                console.log(this.array);
                console.log("----");
                console.log(this.clusters);
                stop = true;
                return clusterNr;
            }
        }
        return -1;
    }
}

interface IComparable {
    compareTo(other: IComparable): number;
}

class Heap<T extends IComparable> {

    private array: T[];

    constructor() {
        this.array = [];
    }

    public add(obj: T): void {
        this.array.push(obj);
        this.checkParentRequirement(this.array.length - 1);
    }

    public replaceAt(idx: number, newobj: T): void {

        this.array[idx] = newobj;
        this.checkParentRequirement(idx);
        this.checkChildrenRequirement(idx);
    }

    public shift(): T {
        return this.removeAt(0);
    }

    public remove(obj: T): void {
        var idx: number = this.indexOf(obj);
        if (idx == -1)
            return;
        this.removeAt(idx);
    }

    private removeAt(idx: number): T {
        var obj: any = this.array[idx];
        if (this.array.length > 0) {
            var newobj: any = this.array.pop();
            this.replaceAt(idx, newobj);
        }
        return obj;
    }

    private indexOf(obj: T): number {
        for (var i: number = 0; i < this.array.length; i++) {
            if (this.array[i].compareTo(obj) == 0)
                return i;
        }
        return -1;
    }

    public size(): number {
        return this.array.length;
    }

    private checkChildrenRequirement(idx: number): void {
        var left: number = this.getLeftChildIndex(idx);
        var right: number = left == -1 ? -1 : left + 1;

        if (left == -1)
            return;

        var minIdx: number;
        if (right == -1)
            minIdx = left;
        else
            minIdx = (this.array[left].compareTo(this.array[right]) < 0) ? left : right;

        if (this.array[idx].compareTo(this.array[minIdx]) > 0) {
            this.swap(idx, minIdx);
            this.checkChildrenRequirement(minIdx);
        }
    }

    private checkParentRequirement(idx: number): void {
        var curIdx: number = idx;
        var parentIdx: number = Heap.getParentIndex(curIdx);
        while (parentIdx >= 0 && this.array[parentIdx].compareTo(this.array[curIdx]) > 0) {
            this.swap(curIdx, parentIdx);

            curIdx = parentIdx;
            parentIdx = Heap.getParentIndex(curIdx);
        }
    }

    public dump(): void {
        console.log(this.array);
    }

    private swap(i: number, j: number): void {
        //console.log("swap " + i + " " + JSON.stringify(this.array[i]) + " <-> " + j + " " + JSON.stringify(this.array[j]));
        var tmp: T = this.array[i];
        this.array[i] = this.array[j];
        this.array[j] = tmp;
    }

    private getLeftChildIndex(curIdx: number): number {
        var idx: number = ((curIdx + 1) * 2) - 1;
        if (idx >= this.array.length)
            return -1;
        else
            return idx;
    }

    private static getParentIndex(curIdx: number): number {
        if (curIdx == 0)
            return -1;

        return Math.floor((curIdx + 1) / 2) - 1;
    }
}

class Value implements IComparable {

    private value: number;
    constructor(value: number) {
        this.value = value;
    }

    public compareTo(other: IComparable): number {
        if (this.value == (<Value>other).value)
            return 0;
        else if (this.value < (<Value>other).value)
            return -1;
        else
            return 1;
    }
}

class PriorityQueue<T extends IComparable> {

    private heap: Heap<T> = new Heap<T>();

    public enqueue(obj: T): void {
        this.heap.add(obj);
    }

    public size(): number {
        return this.heap.size();
    }

    public dequeue(): T {
        return this.heap.shift();
    }
}

class Program {

    private static clustering: KruskalClustering;

    public static testHeap(): void {
        var heap: Heap<Value> = new Heap<Value>();
        heap.add(new Value(10));
        heap.add(new Value(5));
        heap.add(new Value(2));
        heap.add(new Value(15));
        heap.add(new Value(1));
        heap.dump();
        heap.remove(new Value(5));
        heap.dump();
        heap.shift();
        heap.dump();
    }

    public static main(): void {

        Program.testHeap();

        var container: HTMLDivElement = <HTMLDivElement>document.getElementById("pcontainer");
        var mgr: ParticleManager = new ParticleManager(container);
        mgr.createParticles(50);


        var clustering = new KruskalClustering(mgr.particles);
        this.clustering = clustering;

        $("#btnCluster").click(function() {
            doStep();
        })

        function doStep() {
            if (clustering.isDone())
                return;

            var clusterNr: number = clustering.step();
            mgr.moveParticlesToClusterCenter(clustering.clusters, clusterNr);

            window.setTimeout(doStep, 1200);
        }
    }
}
$(document).ready(function() {
    Program.main();
});


