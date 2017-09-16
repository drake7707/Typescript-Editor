var mainCanvas: HTMLCanvasElement;
var mainCanvasContext: CanvasRenderingContext2D;

var buffer: HTMLCanvasElement;
var ctxBuffer: CanvasRenderingContext2D;

var particles: Particle[] = [];

class Particle {

    x0: number;
    y0: number;

    x: number;
    y: number;

    size: number;

    alive: boolean;
    seed: number;
    color: any;

    update: Function;
}

class Settings {

    traceLines: boolean = true;
    connectEndToStart: boolean = true;
    applyGrid: boolean = true;
    nrOfParticles: number = 10;
    sizeOfParticles: number = 1;
    applyTrail: boolean = true;
}
var settings: Settings = new Settings();

var curT: number = 0;
var MAX_T: number = 100;


$(document).ready(function () {
    mainCanvas = <HTMLCanvasElement>$("#c").get(0);


    mainCanvasContext = mainCanvas.getContext("2d");

    buffer = <HTMLCanvasElement>document.createElement("canvas");
    buffer.width = mainCanvas.width;
    buffer.height = mainCanvas.height;
    ctxBuffer = buffer.getContext("2d");

    initializeControls();

    mainCanvasContext.fillStyle = "rgba(0,0,0,1)";
    mainCanvasContext.fillRect(0, 0, mainCanvas.width, mainCanvas.height);

    setNrOfParticles(settings.nrOfParticles);
    setSizeOfParticles(settings.sizeOfParticles);

    createParticles();

    step(mainCanvasContext);
    window.setTimeout(run, 25);
});

function initializeControls() {

    $("input[type=checkbox]").each(function (el) {
        var attr = $(el).attr("data-var");
        $(el).prop("checked", settings[attr]);
    });

    $("input[type=checkbox]").change(function () {
        var attr = $(this).attr("data-var");
        settings[attr] = $(this).prop("checked");
        clear(mainCanvasContext);
    });
    $("input[type=checkbox]").change();
    $("input[type=checkbox]").each(function (el) {
        $(el).prop("checked", settings[window[$(el).attr("data-var")]]);
    });

    $("#btnError").click(function () {
        $("tttt").somethingerror();
    });
}



function setNrOfParticles(nr: number) {
    nr = Math.floor(nr);
    settings.nrOfParticles = nr;
}

function setSizeOfParticles(nr: number) {
    nr = Math.floor(nr);
    settings.sizeOfParticles = nr;
}

function createParticles() {
    particles = [];
    for (var i = 0; i < settings.nrOfParticles; i++) {
        particles.push(createParticle(i / settings.nrOfParticles));
    }
}

function run() {
    step(mainCanvasContext);
    $("div.curTime").css("left", curT / MAX_T * $(".timeBar").width() + "px");
    window.setTimeout(run, 25);
}

function step(ctx: CanvasRenderingContext2D) {

    if (settings.applyTrail)
        ctx.fillStyle = "rgba(0,0,0,0.05)";
    else
        ctx.fillStyle = "rgba(0,0,0,1)";

    ctx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);

    var size: number = mainCanvas.width / 1000;
    for (var i = 0; i < particles.length; i++) {
        if (particles[i].alive) {
            var thickness: number = size * particles[i].size;
            ctx.lineWidth = thickness;

            var oldX = particles[i].x;
            var oldY = particles[i].y;
            particles[i].update(curT / MAX_T);
            if (settings.connectEndToStart || curT > 0) {
                ctx.strokeStyle = particles[i].color;

                ctx.beginPath();
                ctx.fillStyle = particles[i].color;

                ctx.arc(particles[i].x * mainCanvas.width, particles[i].y * mainCanvas.height, thickness / 2, 0, 2 * Math.PI, false);
                ctx.fill();

                if (settings.applyTrail) {
                    drawLine(ctx, oldX * mainCanvas.width, oldY * mainCanvas.height, particles[i].x * mainCanvas.width, particles[i].y * mainCanvas.height);
                    drawLine(ctxBuffer, oldX * mainCanvas.width, oldY * mainCanvas.height, particles[i].x * mainCanvas.width, particles[i].y * mainCanvas.height);
                }
            }
        }
    }

    if (settings.traceLines) {
        ctx.globalAlpha = 0.01;
        //  uncomment to draw lines
        ctx.drawImage(buffer, 0, 0);
        ctx.globalAlpha = 1;
    }

    if (settings.applyGrid)
        drawGrid(ctxBuffer);

    curT++;
    curT = curT % MAX_T;
}


var updateFunc = function (p, t) {
    if (!p.alive)
        return;

    var v: any = {};

    var angle = (p.seed * 2 + t) * 2 * Math.PI;
    var radius = Math.sin(t * Math.PI * 5) * 0.1 + (Math.sin(t * Math.PI * 2)) * 0.25;
    v.x = radius * Math.cos(angle);
    v.y = radius * Math.sin(angle) * (p.seed < 0.5 ? -1 : 1);

    p.x = p.x0 + v.x;
    p.y = p.y0 + v.y;

    p.size = 2 + 50 * (1 + Math.cos(t * Math.PI * 4));
    var r = Math.floor(p.seed * 255);
    var g = Math.floor(p.seed * 255);
    var b = Math.floor(p.seed * 255);
    p.color = "rgba(" + 255 + "," + g + "," + 0 + ",0.5)";

};

function createParticle(i): Particle {

    var increment = 250;
    var p = new Particle();
    p.x0 = 0.5;
    p.y0 = 0.5;

    p.size = settings.sizeOfParticles;
    p.alive = true;
    p.seed = i; //Math.random();
    p.color = "rgba(200,200,200,1)";

    p.update = function (t) {
        if (updateFunc != null)
            updateFunc(p, t);
    };
    return p;
}

function clear(ctx: CanvasRenderingContext2D) {

    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
    ctxBuffer.fillStyle = "rgba(0,0,0,1)";
    ctxBuffer.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
}


function drawLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}



function drawGrid(ctx: CanvasRenderingContext2D) {
    var i: number = 0;

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    while (i < 1) {
        drawLine(ctx, 0 * mainCanvas.width, i * mainCanvas.height, 1 * mainCanvas.width, i * mainCanvas.height);
        drawLine(ctx, i * mainCanvas.width, 0 * mainCanvas.height, i * mainCanvas.width, 1 * mainCanvas.height);
        i += 0.1;
    }
}


function cloneCanvas(oldCanvas): HTMLCanvasElement {
    //create a new canvas
    var newCanvas: HTMLCanvasElement = <HTMLCanvasElement>document.createElement('canvas');
    var context = newCanvas.getContext('2d');

    //set dimensions
    newCanvas.width = oldCanvas.width;
    newCanvas.height = oldCanvas.height;

    //apply the old canvas to the new one
    context.drawImage(oldCanvas, 0, 0);

    //return the new canvas
    return newCanvas;
}
