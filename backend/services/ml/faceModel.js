const sharp = require("sharp");
const { defineModel } = require("../modelStore");
const { fail } = require("../integrity");

const SIZE = 640;
const revision = "d176ecd95c7a9ece144dbb23193fbe35f0221773";
const hashes = {
    s: "1c4eac37a7a5efbe791225022799ac8980743bf0271204f43f782b327785c1eb",
    n: "9506b1f2b497cf0d3c39eb756ecacef82965d6d01e8037f3c2a91f6cb1b22297",
};
const models = new Map(Object.entries(hashes).map(([size, sha256]) => {
    const name = `face_yolo11${size}_fp32.onnx`;
    return [size, defineModel({
        id: "faces-" + size, label: `YOLO11${size}-Face`, version: revision + size,
        licence: "AGPL-3.0", optional: size === "n",
        files: {model: {name, sha256, url: `https://huggingface.co/Banaxi-Tech/face-model/resolve/${revision}/yolo11${size}/${name}`}},
        gpu: {inputName:"images", inputShape:[1,3,SIZE,SIZE]},
    })];
}));

function starts(length, tile) {
    const count = Math.ceil((length-tile)/(tile*0.75));
    return Array.from({length:count+1}, (_,i)=>Math.round(i*(length-tile)/(count||1)));
}

function suppress(boxes) {
    const kept=[];
    for (const b of boxes.sort((a,c)=>c.score-a.score)) {
        const duplicate=kept.some(a=>{
            const w=Math.max(0,Math.min(a.r,b.r)-Math.max(a.l,b.l));
            const h=Math.max(0,Math.min(a.b,b.b)-Math.max(a.t,b.t));
            const intersection=w*h;
            return intersection>0.45*((a.r-a.l)*(a.b-a.t)+(b.r-b.l)*(b.b-b.t)-intersection);
        });
        if (!duplicate) kept.push(b);
    }
    return kept;
}

async function detectFaces(file, size="s") {
    const model=models.get(size);
    if (!model) fail(400,"Choose the small or nano face model.");
    const {data,info:{width,height}}=await sharp(file).rotate()
        .resize({width:4096,height:2048,fit:"inside",withoutEnlargement:true})
        .toColourspace("srgb").removeAlpha().raw().toBuffer({resolveWithObject:true});
    const tile=Math.min(SIZE,width,height);
    const columns=starts(width,tile);
    // One extra view centred on the equirectangular seam catches faces split between edges.
    if(width>=1.8*height && tile>1) columns.push(width-Math.floor(tile/2));
    const boxes=[];
    for(const y of starts(height,tile)) for(const x of columns) {
        const input=new Float32Array(3*SIZE*SIZE);
        for(let j=0;j<SIZE;j++) {
            const row=(y+Math.floor(j*tile/SIZE))*width;
            for(let i=0;i<SIZE;i++) {
                const src=(row+(x+Math.floor(i*tile/SIZE))%width)*3, dst=j*SIZE+i;
                for(let c=0;c<3;c++) input[c*SIZE*SIZE+dst]=data[src+c]/255;
            }
        }
        const {output0}=await model.run(ort=>({images:new ort.Tensor("float32",input,[1,3,SIZE,SIZE])}));
        const a=output0.data, n=output0.dims[2];
        for(let i=0;i<n;i++) {
            const score=a[4*n+i];
            if(score<0.25) continue;
            const cx=a[i],cy=a[n+i],rx=a[2*n+i]*0.62,ry=a[3*n+i]*0.65;
            const l=x+Math.max(0,cx-rx)*tile/SIZE, r=x+Math.min(SIZE,cx+rx)*tile/SIZE;
            const t=y+Math.max(0,cy-ry)*tile/SIZE,b=y+Math.min(SIZE,cy+ry)*tile/SIZE;
            if(b<=t || r<=l) continue;
            if(l<width) boxes.push({l,r:Math.min(width,r),t,b,score});
            if(r>width) boxes.push({l:Math.max(0,l-width),r:r-width,t,b,score});
        }
    }
    return suppress(boxes).map(({l,r,t,b})=>({x:l/width,y:t/height,w:(r-l)/width,h:(b-t)/height}));
}
module.exports={detectFaces};
