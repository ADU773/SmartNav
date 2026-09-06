const fs = require("fs");
const path = require("path");
const Asset = require("../models/Asset");

const uploadImage = async (req, res) => {

    try {

        const { projectId } = req.body;

        if (!projectId) {

            return res.status(400).json({

                success: false,

                message: "Project ID is required."

            });

        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Select an image file to upload."
            });
        }

        const asset = await Asset.create({

            projectId,

            filename: req.file.filename,

            originalName: req.file.originalname,

            path: `/uploads/${req.file.filename}`

        });

        res.status(200).json({

            success: true,

            data: asset

        });

    } catch (error) {

        res.status(500).json({

            success: false,

            message: error.message

        });

    }

};

const getUploads = async (req,res)=>{

    try{

        const { projectId } = req.query;

        if(!projectId){

            return res.status(400).json({

                success:false,

                message:"Project ID required"

            });

        }

        const uploads = await Asset.find({

            projectId

        });

        res.status(200).json({

            success:true,

            data:uploads

        });

    }

    catch(error){

        res.status(500).json({

            success:false,

            message:error.message

        });

    }

};


module.exports = {
    uploadImage,
    getUploads
};
