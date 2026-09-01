// Givebutter's widget-loader script (defines the <givebutter-widget> custom element)
// — account-specific. Given by the studio directly, not discoverable from anything
// else in this repo. `acct` is Givebutter's own public account hash, not the plain
// numeric account id (confirmed against the real widget: a bare numeric id gets
// rejected at runtime with "Invalid ?acct= format"). Shared so the kiosk
// (web/src/useGivebutterWidgetScript.ts) and the public sign-up widget
// (web-student/signup.html) both load the same script instead of each hardcoding
// their own copy of the account hash.
export const GIVEBUTTER_WIDGET_SCRIPT_SRC = "https://widgets.givebutter.com/latest.umd.cjs?acct=K2zE8rPXlwbTczim&p=other";
