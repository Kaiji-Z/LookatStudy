/**
 * Toggle —— 项目内唯一的开关控件(canonical form-control vocabulary)。
 * ON = bg-brand(绿);OFF = bg-ink/20(主题感知半透明灰)。role=switch + aria。
 * (v0.38 从 SettingsView 抽出:模型管理弹窗的看图 tab 与抽屉共用同一开关。)
 */
export function Toggle({
  checked,
  onChange,
  label,
  testid,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  testid: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      data-testid={testid}
      className={`relative w-12 h-6 rounded-full transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-2)] ${
        checked ? "bg-brand" : "bg-ink/20 hover:bg-ink/25"
      }`}
    >
      <span
        className={`absolute left-0.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-6" : ""}`}
      />
    </button>
  );
}
