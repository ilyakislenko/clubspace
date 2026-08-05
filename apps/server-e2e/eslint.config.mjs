import baseConfig from "../../eslint.config.mjs";

export default [
    ...baseConfig,
    {
        files: ["src/**/*.ts"],
        rules: {
            // This project exists to boot apps/server's real AppModule in
            // process and drive it over HTTP, so it imports the server's
            // internals by path on purpose. The dependency is declared in
            // package.json (`implicitDependencies: ["@clubspace/server"]`);
            // the boundary rule's usual point — keeping apps from reaching
            // into each other — does not apply to an app's own e2e suite,
            // and the alternative (publishing the server's guards and
            // services through a public entrypoint just so a test can reach
            // them) would be a worse design driven by a lint rule.
            "@nx/enforce-module-boundaries": "off",
        },
    },
];
