const Scene = require("../models/Scene");

const createScene = async (req, res) => {
    try {

        const { projectId, name, image } = req.body;

        const scene = await Scene.create({
            projectId,
            name,
            image
        });

        res.status(201).json({
            success: true,
            message: "Scene created successfully",
            data: scene
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }
};




const getScenes = async (req, res) => {

    try {

        const { projectId } = req.query;

        const filter = {};

        if (projectId) {

            filter.projectId = projectId;

        }

        console.log("Requested Project ID:", projectId);

        console.log("Filter:", filter);

        const scenes = await Scene.find(filter);

        console.log("Returned:", scenes.length);

        res.status(200).json({
            success: true,
            count: scenes.length,
            data: scenes
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};




const getSceneById = async (req, res) => {

    try {

        const scene = await Scene.findById(req.params.id)
            .populate("projectId", "name");

        if (!scene) {

            return res.status(404).json({
                success: false,
                message: "Scene not found"
            });

        }

        res.status(200).json({
            success: true,
            data: scene
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};



const deleteScene = async (req, res) => {

    try {

        const scene = await Scene.findByIdAndDelete(req.params.id);

        if (!scene) {

            return res.status(404).json({
                success: false,
                message: "Scene not found"
            });

        }

        res.status(200).json({
            success: true,
            message: "Scene deleted successfully"
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};


const connectScenes = async (req, res) => {

    try {

        const { id } = req.params;

        const {
            targetSceneId,
            label,
            yaw,
            pitch,
            distance
        } = req.body;

        if (!targetSceneId) {
            return res.status(400).json({ success: false, message: "A target scene is required." });
        }

        const scene = await Scene.findById(id);

        if (!scene) {

            return res.status(404).json({
                success: false,
                message: "Scene not found"
            });

        }

        const hotspotExists = scene.hotspots.some((hotspot) => {

            if (!hotspot.targetScene) {
                return false;
            }

            return hotspot.targetScene.toString() === targetSceneId;

        });

        if (hotspotExists) {

            return res.status(400).json({
                success: false,
                message: "Hotspot already exists."
            });

        }

        scene.hotspots.push({

            targetScene: targetSceneId,

            label,

            yaw: Number.isFinite(Number(yaw)) ? Number(yaw) : 0,

            pitch: Number.isFinite(Number(pitch)) ? Number(pitch) : 0,

            distance: Number.isFinite(Number(distance)) ? Number(distance) : 0

        });

        await scene.save();

        res.status(200).json({

            success: true,

            message: "Scenes connected successfully.",

            data: scene

        });

    } catch (error) {

        res.status(500).json({

            success: false,

            message: error.message

        });

    }

};


const updateScene = async (req, res) => {

    try {

        const scene = await Scene.findByIdAndUpdate(

            req.params.id,

            req.body,

            {

                new: true,

                runValidators: true

            }

        );

        if (!scene) {

            return res.status(404).json({

                success: false,

                message: "Scene not found"

            });

        }

        res.status(200).json({

            success: true,

            message: "Scene updated successfully",

            data: scene

        });

    } catch (error) {

        res.status(500).json({

            success: false,

            message: error.message

        });

    }

};

module.exports = {

    createScene,

    getScenes,

    getSceneById,

    updateScene,

    deleteScene,

    connectScenes

};
