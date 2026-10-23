import { ToggleSwitch } from "../../toggle-switch";
import { Icon } from "../../zen-ui";
import styles from "../../zen-dashboard.module.css";
import type { Guardrails } from "@/lib/journey-types";

/**
 * Three standing preferences the traveller sets once and stops thinking about.
 *
 * They are ordinary scheduling rules, not health guidance, and each one becomes
 * a constraint the composer has to respect — which is why they are worth
 * remembering between trips.
 */

export const GUARDRAILS: ReadonlyArray<{
  key: keyof Guardrails;
  name: string;
  effect: string;
  icon: "sun" | "lock" | "leaf";
}> = [
  {
    key: "protectReservations",
    name: "保护已订安排",
    effect: "已有的预约时间与名称原样保留，重新规划时不会自动挪动。",
    icon: "lock",
  },
  {
    key: "morningLight",
    name: "晨间见光",
    effect: "行程日安排一段户外时间，帮助落地后尽快跟上当地作息。",
    icon: "sun",
  },
  {
    key: "sensoryBreaks",
    name: "规律停顿",
    effect: "每隔一段时间插入一段安静的独处时间，不安排新的移动。",
    icon: "leaf",
  },
];

export function GuardrailToggles({
  value,
  onChange,
  disabled,
}: {
  value: Guardrails;
  onChange: (next: Guardrails) => void;
  disabled?: boolean;
}) {
  return (
    <section className={styles.card} aria-labelledby="guardrail-heading">
      <div className={styles.sectionHead}>
        <span><Icon name="shield" /><strong id="guardrail-heading">旅途守护</strong></span>
        <Badge>设定一次，长期生效</Badge>
      </div>
      <div className={styles.guardrailList}>
        {GUARDRAILS.map((item) => {
          const on = value[item.key];
          return (
            <label className={styles.guardrail} key={item.key}>
              <span className={styles.guardrailIcon}><Icon name={item.icon} size={17} /></span>
              <span className={styles.guardrailText}>
                <strong>{item.name}</strong>
                <small>{item.effect}</small>
              </span>
              <ToggleSwitch
                checked={on}
                disabled={disabled}
                label={item.name}
                onChange={(enabled) => onChange({ ...value, [item.key]: enabled })}
              />
            </label>
          );
        })}
      </div>
      <p className={styles.note}>这些都是行程安排规则。BioTrip 不会替你判断身体状况，也不会给出医疗建议。</p>
    </section>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className={styles.chip}>{children}</span>;
}