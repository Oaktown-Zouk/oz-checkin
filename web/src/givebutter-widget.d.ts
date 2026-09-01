// Declares <givebutter-widget> as a valid JSX intrinsic element — it's a custom
// element defined at runtime by Givebutter's own loader script (see
// useGivebutterWidgetScript.ts), not something @types/react knows about natively.
import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "givebutter-widget": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & { id: string };
    }
  }
}
