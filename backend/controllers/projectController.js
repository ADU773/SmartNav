const Project = require("../models/Project");

// Create Project
const createProject = async (req, res) => {
    try {

        const project = await Project.create(req.body);

        res.status(201).json({
            success: true,
            message: "Project created successfully",
            data: project
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }
};

// Get All Projects
const getProjects = async (req, res) => {

    try {

        const projects = await Project.find().sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            message: "Projects fetched successfully",
            data: projects
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};

// Get Single Project
const getProject = async (req, res) => {

    try {

        const project = await Project.findById(req.params.id);

        if (!project) {

            return res.status(404).json({
                success: false,
                message: "Project not found"
            });

        }

        res.status(200).json({
            success: true,
            data: project
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};

// Update Project
const updateProject = async (req, res) => {

    try {

        const project = await Project.findByIdAndUpdate(
            req.params.id,
            req.body,
            {
                new: true,
                runValidators: true
            }
        );

        if (!project) {

            return res.status(404).json({
                success: false,
                message: "Project not found"
            });

        }

        res.status(200).json({
            success: true,
            message: "Project updated successfully",
            data: project
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};

// Delete Project
const deleteProject = async (req, res) => {

    try {

        const project = await Project.findByIdAndDelete(req.params.id);

        if (!project) {

            return res.status(404).json({
                success: false,
                message: "Project not found"
            });

        }

        res.status(200).json({
            success: true,
            message: "Project deleted successfully"
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};

module.exports = {
    createProject,
    getProjects,
    getProject,
    updateProject,
    deleteProject
};