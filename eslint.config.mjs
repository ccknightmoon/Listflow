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
      // The experimental React Compiler (also part of this plugin) bails
      // out of auto-optimizing a component when it can't statically
      // preserve an existing manual useMemo/useCallback, and treats that
      // as an error by default. This is a "couldn't apply an extra,
      // optional optimization pass" notice, not a correctness issue — the
      // hand-written memoization still runs exactly as written either
      // way. Seen tripping on unrelated useMemo calls elsewhere in a
      // component after restructuring an async data-loading function
      // (src/app/store/page.tsx's loadAll) in a way the compiler's
      // static analysis couldn't follow, with no actual bug in either.
      // Downgraded rather than fighting the compiler's static-analysis
      // limits with speculative code restructuring.
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
];

export default eslintConfig;
