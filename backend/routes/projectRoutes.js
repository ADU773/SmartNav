const express = require("express");

const router = express.Router();

const {

    createProject,
    getProjects,
    getProject,
    updateProject,
    deleteProject

} = require("../controllers/projectController");

router.get("/", getProjects);

router.get("/:id", getProject);

router.post("/", createProject);

router.put("/:id", updateProject);

router.delete("/:id", deleteProject);

module.exports = router;