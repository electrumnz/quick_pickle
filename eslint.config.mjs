import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    ".lighthouseci/**",
    "next-env.d.ts",
  ]),
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // react-three-fiber does not re-render a WebGL scene; it mutates one.
    //
    // `react-hooks/immutability` enforces the React Compiler's model, in which
    // a value produced by a hook is frozen once render is over. Every frame of
    // this directory breaks that on purpose: `useFrame` advances a shader's
    // `uTime` uniform, writes an object's position and rotation, and sets
    // material properties on the instances `useMemo` built — and `useThree`
    // hands back the renderer and the camera precisely so they can be
    // configured in place. There is no immutable spelling of any of it. A
    // material rebuilt to satisfy the rule would recompile its shader program,
    // which is the single most expensive thing this scene can do, and a camera
    // "replaced" rather than moved is not a camera the renderer is holding.
    //
    // So this is scoped to the one directory that drives a render loop, and to
    // the one rule whose model does not describe that loop. The rest of the
    // React Compiler set stays on here and earned its keep: `purity` caught a
    // clock read during render in the lab's FPS probe, and
    // `set-state-in-effect` caught two effects mirroring values that should
    // have been derived, one of which left a forced quality tier latched on.
    // Nothing outside components/3d is affected, and nothing in it is exempt
    // from any other rule.
    files: ["components/3d/**/*.{ts,tsx}"],
    rules: { "react-hooks/immutability": "off" },
  },
]);

export default eslintConfig;
