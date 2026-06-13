import baseConfig from "../../eslint.config.mjs";

export default [
    ...baseConfig,
    {
        // Test doubles legitimately declare empty controller methods purely to
        // hang @Roles metadata on — the bodies are never called.
        files: ["**/*.spec.ts"],
        rules: {
            "@typescript-eslint/no-empty-function": "off",
        },
    },
];
