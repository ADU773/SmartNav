const router = require("express").Router();
const path = require("path");
const Asset = require("../models/Asset");
const Scene = require("../models/Scene");
const Project = require("../models/Project");
const { requireAuth } = require("../middleware/authMiddleware");
const { readableProject, fail, sendError, requireId } = require("../services/integrity");
const { localFileFor } = require("../services/placeIndex");
const privacy = require("../services/privacy");
const wrap = fn => (req,res) => fn(req,res).catch(err=>sendError(res,err));

router.get("/projects/:id/privacy",requireAuth,wrap(async(req,res)=>{
    const project=await readableProject(req.params.id,req.user.id);
    const scenes=await Scene.find({projectId:project._id}).select("name image").lean();
    const assets=await privacy.assetsFor(project,scenes);
    res.json({success:true,data:assets.map(a=>({
        id:a._id, path:a.path, name:scenes.filter(s=>s.image===a.path).map(s=>s.name).join(", ") || "Floor plan",
        approved:!!a.privacy?.version, scanned:!!a.privacyScan, masks:a.privacy?.masks || a.privacyScan?.masks || [],
        people:a.privacyScan?.people || []
    }))});
}));
async function owned(req) {
    requireId(req.params.asset,"asset ID");
    const asset=await Asset.findById(req.params.asset).lean();
    if (!asset) fail(404,"Image not found.");
    await readableProject(String(asset.projectId),req.user.id);
    return asset;
}
let busy=false;
router.get("/privacy/:asset",requireAuth,wrap(async(req,res)=>{
    const a=await owned(req);
    res.json({success:true,data:{
        id:a._id,path:a.path,name:a.originalName || a.filename,approved:!!a.privacy?.version,
        scanned:!!a.privacyScan,masks:a.privacy?.masks || a.privacyScan?.masks || [],people:a.privacyScan?.people || []
    }});
}));
router.post("/privacy/:asset/scan",requireAuth,wrap(async(req,res)=>{
    const asset=await owned(req);
    if (busy) fail(429,"Another privacy scan is running. Try again shortly.");
    busy=true;
    try {
        const result=await privacy.scan(asset,req.body?.modelSize);
        await Asset.updateOne({_id:asset._id},{$set:{privacyScan:result}});
        res.json({success:true,data:result});
    } finally {busy=false;}
}));
router.post("/privacy/:asset/approve",requireAuth,wrap(async(req,res)=>{
    const asset=await owned(req);
    if (!asset.privacyScan) fail(409,"Scan this image before approving it.");
    const result=await privacy.render(localFileFor(asset.path),req.body.masks);
    const previous=await Asset.findOneAndUpdate({_id:asset._id},{$set:{privacy:result}}).select("privacy").lean();
    const obsolete=previous ? previous.privacy : result;
    if (obsolete) {
        const fs=require("fs/promises");
        await Promise.allSettled([obsolete.version,obsolete.thumb].filter(Boolean).map(name=>fs.unlink(path.join(privacy.root,name))));
    }
    if(!previous) fail(409,"The asset was removed during review.");
    res.json({success:true});
}));
function publicImage(token,asset,thumb=false) {
    return "/api/published/"+token+"/media/"+asset._id+(thumb?"?size=thumb":"");
}
router.get("/published/:token/media/:asset",wrap(async(req,res)=>{
    requireId(req.params.asset,"asset ID");
    const project=await Project.findOne({published:true,shareToken:req.params.token}).select("_id floorPlan").lean();
    if (!project) fail(404,"Tour not found.");
    const asset=await Asset.findOne({_id:req.params.asset,projectId:project._id}).lean();
    if (!asset?.privacy?.version || (project.floorPlan!==asset.path && !await Scene.exists({projectId:project._id,image:asset.path}))) fail(404,"Reviewed image not found.");
    res.set("Cache-Control","no-store");
    res.sendFile(path.join(privacy.root,req.query.size==="thumb"?asset.privacy.thumb:asset.privacy.version));
}));
module.exports={router,publicImage};
