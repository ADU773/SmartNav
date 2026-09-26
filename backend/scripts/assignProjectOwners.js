/**
 * Migration: assign an owner to projects created before multi-tenancy.
 *
 * `Project.ownerId` is now required and every query is scoped by it, so
 * projects written by the pre-auth version of this app are invisible to
 * everyone. This backfills them onto one account.
 *
 * Usage:
 *   node scripts/assignProjectOwners.js --email you@example.com
 *   node scripts/assignProjectOwners.js --email you@example.com --dry-run
 *
 * Safe to re-run: projects that already have an owner are left alone.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const runtime = require("../config/runtime");
const Project = require("../models/Project");
const User = require("../models/User");

function arg(name) {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? null : process.argv[index + 1];
}

async function main() {
    const email = (arg("email") || "").toLowerCase().trim();
    const dryRun = process.argv.includes("--dry-run");

    if (!email) {
        console.error("Usage: node scripts/assignProjectOwners.js --email you@example.com [--dry-run]");
        process.exit(1);
    }

    const env = runtime.init();
    await mongoose.connect(env.MONGODB_URI);

    try {
        const user = await User.findOne({ email });
        if (!user) {
            console.error(`No account found for ${email}. Register it in the app first, then re-run this.`);
            process.exitCode = 1;
            return;
        }

        const orphaned = await Project.countDocuments({ $or: [{ ownerId: { $exists: false } }, { ownerId: null }] });
        if (orphaned === 0) {
            console.log("Nothing to migrate: every project already has an owner.");
            return;
        }

        console.log(`${orphaned} project(s) without an owner will be assigned to ${email} (${user._id}).`);
        if (dryRun) {
            const sample = await Project.find({ $or: [{ ownerId: { $exists: false } }, { ownerId: null }] })
                .select("name createdAt").limit(20).lean();
            sample.forEach((project) => console.log(`  - ${project.name} (${project._id})`));
            console.log("Dry run: nothing was written.");
            return;
        }

        const result = await Project.updateMany(
            { $or: [{ ownerId: { $exists: false } }, { ownerId: null }] },
            { $set: { ownerId: user._id } }
        );
        console.log(`Done. ${result.modifiedCount} project(s) now belong to ${email}.`);
        console.log("Their scenes, assets and analytics follow the project, so nothing else needs changing.");
    } finally {
        await mongoose.connection.close();
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
