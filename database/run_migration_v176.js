const runMigration = require('./migration_v176_egg_dispatch_and_vehicle_logistics');

(async () => {
    try {
        await runMigration();
        console.log('Migration v176 execution finished successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Fatal migration v176 error:', err);
        process.exit(1);
    }
})();
