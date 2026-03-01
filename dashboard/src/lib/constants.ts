export const PIPELINE_ID = "GeLwykvW1Fup6Z5oiKir";
export const LOCATION_ID = "iCyLg9rh8NtPpTfFCcGk";
export const GHL_BASE = "https://services.leadconnectorhq.com";
export const GHL_API_VERSION = "2021-07-28";
export const USER_AGENT = "FTL-Prints-Pipeline/1.0";
export const MAX_CONCURRENT = 3;

export const ACTIVE_STAGES: Record<string, string> = {
  "29fcf7b0-289c-44a4-ad25-1d1a0aea9063": "New Lead",
  "5ee824df-7708-4aba-9177-d5ac02dd6828": "In Progress",
  "259ee5f4-5667-4797-948e-f36ec28c70a0": "Quote Sent",
  "accf1eef-aa13-46c3-938d-f3ec6fbe498b": "Needs Attention",
  "336a5bee-cad2-400f-83fd-cae1bc837029": "Follow Up",
};

export const INACTIVE_STAGES: Record<string, string> = {
  "1ab155c2-282d-45eb-bd43-1052489eb2a1": "Sale",
  "7ec748b8-920d-4bdb-bf09-74dd22d27846": "Cooled Off",
  "b909061c-9141-45d7-b1e2-fd37432c3596": "Unqualified",
};

export const STAGE_IDS: Record<string, string> = {
  "New Lead": "29fcf7b0-289c-44a4-ad25-1d1a0aea9063",
  "In Progress": "5ee824df-7708-4aba-9177-d5ac02dd6828",
  "Quote Sent": "259ee5f4-5667-4797-948e-f36ec28c70a0",
  "Needs Attention": "accf1eef-aa13-46c3-938d-f3ec6fbe498b",
  "Follow Up": "336a5bee-cad2-400f-83fd-cae1bc837029",
  "Sale": "1ab155c2-282d-45eb-bd43-1052489eb2a1",
  "Cooled Off": "7ec748b8-920d-4bdb-bf09-74dd22d27846",
  "Unqualified": "b909061c-9141-45d7-b1e2-fd37432c3596",
};

export const CUSTOM_FIELDS: Record<string, string> = {
  JHW5PxBCcgu43kKGLMDs: "artwork",
  JzrbUu1GzN23Zh1DoPWV: "quantity",
  T3YKV1ASH2yYKnUA4f2U: "project_details",
  TslKUu7r74uPuHcdkYYG: "service_type",
  Zg16bXIPdxyVDB9fSQQC: "budget",
  fWONzFx0SZrXbK81RgJn: "sizes",
};

// Non-US +1 area codes (Canadian + Caribbean — Twilio calls fail)
export const NON_US_NANP_AREA_CODES = new Set([
  // Canada
  "204","226","236","249","250","263","289","306","343","354",
  "365","367","368","382","403","416","418","428","431","437",
  "438","450","460","468","474","506","514","519","548","579",
  "581","584","587","604","613","639","647","672","683","705",
  "709","742","753","778","780","782","807","819","825","867",
  "873","879","902","905",
  // Caribbean / Atlantic +1 territories
  "242","246","268","284","340","345","441","473","649","664",
  "721","758","767","784","809","829","849","868","869","876",
]);

export const NON_NANP_INTL_PREFIXES = ["+41", "+44"];

export const CHANNEL_MAP: Record<string, string> = {
  TYPE_EMAIL: "email",
  TYPE_SMS: "sms",
  TYPE_CALL: "call",
};
