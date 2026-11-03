const sharp = require("sharp");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
const { detectFaces } = require("./ml/faceModel");
const Asset = require("../models/Asset");
const Scene = require("../models/Scene");
const { localFileFor } = require("./placeIndex");
const { fail } = require("./integrity");
const root = path.join(__dirname, "../reviewed-media");

async function assetsFor(project, scenes) {
    const paths = [...new Set([project.floorPlan, ...scenes.map(s => s.image)].filter(Boolean))];
    const assets = await Asset.find({ projectId:project._id, path:{ $in:paths } }).lean();
    if (assets.length !== paths.length) fail(409,"Upload external or missing images as project assets before privacy review.");
    return assets;
}
async function reviewed(project, scenes) {
    const assets = await assetsFor(project, scenes);
    if (assets.some(a => !a.privacy?.version)) fail(409,"Approve every panorama and floor plan in Privacy Review before sharing this tour.");
    return new Map(assets.map(a=>[a.path,a]));
}
function validate(masks) {
    if (!Array.isArray(masks) || masks.length > 500 || masks.some(m => !m ||
        ![m.x,m.y,m.w,m.h].every(Number.isFinite) || m.x<0 || m.y<0 || m.w<=0 || m.h<=0 ||
        m.x+m.w>1.000001 || m.y+m.h>1.000001)) fail(400,"Invalid blur region.");
}
async function render(file,masks) {
    validate(masks);
    await fs.mkdir(root,{recursive:true});
    const version=crypto.randomUUID()+".jpg", thumb=crypto.randomUUID()+".webp";
    // Use a bounded, oriented master for both the review geometry and exported pixels.
    const master=await sharp(file).rotate().resize({width:8192,height:4096,fit:"inside",withoutEnlargement:true}).removeAlpha().jpeg().toBuffer();
    const {width,height}=await sharp(master).metadata();
    const layers=[];
    // Bound total decoded overlay memory even when many rectangles overlap.
    if (masks.reduce((sum,m)=>sum+m.w*m.h,0)>4) fail(400,"Merge overlapping blur regions before approving.");
    for (const m of masks) {
        const left=Math.min(width-1,Math.floor(m.x*width)), top=Math.min(height-1,Math.floor(m.y*height));
        const w=Math.min(width-left,Math.ceil((m.x+m.w)*width)-left), h=Math.min(height-top,Math.ceil((m.y+m.h)*height)-top);
        const pixelated=await sharp(master).extract({left,top,width:w,height:h}).resize(Math.min(w,4),Math.min(h,4),{fit:"fill"}).png().toBuffer();
        const input=await sharp(pixelated).resize(w,h,{fit:"fill"}).jpeg().toBuffer();
        layers.push({input,left,top});
    }
    try {
        await sharp(master).composite(layers).jpeg({quality:90}).toFile(path.join(root,version));
        await sharp(path.join(root,version)).resize({width:420,withoutEnlargement:true}).webp().toFile(path.join(root,thumb));
        return {version,thumb,masks,approvedAt:new Date()};
    } catch(e) {
        await Promise.all([version,thumb].map(name=>fs.rm(path.join(root,name),{force:true})));
        throw e;
    }
}
async function scan(asset, modelSize="s") {
    const masks=await detectFaces(localFileFor(asset.path),modelSize);
    validate(masks);
    const scene=await Scene.findOne({projectId:asset.projectId,image:asset.path}).select("image detections objectScan").lean();
    let detections=[];
    if (scene) {
        detections = scene.objectScan?.image===scene.image && scene.objectScan.viewsScanned!=null
            ? scene.detections : (await require("./objectIndex").detectObjectsInScene(scene)).detections;
    }
    const people=detections.filter(d=>d.label==="person" && Number.isFinite(d.yawDeg) && Number.isFinite(d.pitchDeg)).map(d=>({
        x:((d.yawDeg/360+0.5)%1+1)%1,y:Math.min(1,Math.max(0,.5+d.pitchDeg/180))
    }));
    return {masks,people,modelSize};
}
module.exports={root,assetsFor,reviewed,render,scan,validate};
