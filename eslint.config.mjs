import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // eslint-plugin-react-hooks (bundled with eslint-config-next) added
      // this as an error in its newer versions, flagging the common/legit
      // "sync state from an external source on mount" pattern used
      // throughout this app (reading localStorage, URL params, greeting
      // text). Not a bug — downgraded to a warning rather than rewriting
      // unrelated code as part of the Next 16 upgrade.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default eslintConfig;
