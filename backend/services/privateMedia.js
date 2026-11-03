const jwt = require("jsonwebtoken");
const path = require("path");
const Asset = require("../models/Asset");
const Project = require("../models/Project");
const secret = () => require("../config/runtime").env().JWT_ACCESS_SECRET;
const audience = "smartnav-file";
function link(owner, file) {
    const token = jwt.sign({ file, sub: String(owner) }, secret(), { audience, issuer: audience, expiresIn: "2h" });
    return "/uploads/" + encodeURIComponent(file) + "?media=" + token;
}
// Keep stored asset references stable. Give authenticated clients separate,
// file-specific URLs suitable for image elements and WebGL texture loaders.
function attachLinks(req, res, next) {
    const json = res.json.bind(res);
    res.json = body => {
        if (req.user && body?.success && body.data) {
            const links = {};
            JSON.stringify(body.data, (key, value) => {
                if (typeof value === "string" && ["path","image","thumbnailPath","floorPlan"].includes(key)) {
                    const m = /^(?:https?:\/\/[^/]+)?\/?uploads\/([\w.-]+)$/.exec(value);
                    if (m) links[value] = link(req.user.id, m[1]);
                }
                return value;
            });
            if (Object.keys(links).length) body.mediaLinks = links;
        }
        return json(body);
    };
    next();
}
async function serve(req, res) {
    try {
        const file = req.params.file;
        const ticket = jwt.verify(req.query.media, secret(), { audience, issuer: audience });
        if (ticket.file !== file || !/^[\w-][\w.-]*$/.test(file)) return res.sendStatus(403);
        const asset = await Asset.findOne({ $or: [{ filename:file }, { thumbnailFilename:file }] }).select("projectId").lean();
        if (!asset || !await Project.exists({ _id:asset.projectId, ownerId:ticket.sub })) return res.sendStatus(403);
        res.set({"Cache-Control":"private, no-store","Content-Security-Policy":"sandbox; default-src 'none'; style-src 'unsafe-inline'"});
        return res.sendFile(path.join(__dirname,"../uploads",file));
    } catch { return res.sendStatus(403); }
}
module.exports = { link, attachLinks, serve };
