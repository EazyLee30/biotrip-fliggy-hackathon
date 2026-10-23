"use client";

import { Switch } from "@base-ui/react/switch";
import css from "./toggle-switch.module.css";

export function ToggleSwitch({ checked, onChange, label, disabled = false }: {
  checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean;
}) {
  return <Switch.Root className={css.switch} checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label}>
    <span className={css.track} aria-hidden="true"><Switch.Thumb className={css.thumb} /></span>
  </Switch.Root>;
}
