import Link from "next/link";
import styles from "./page.module.css";

const FEATURES = [
  {
    icon: "\u23F1",
    title: "fair start",
    desc: "5-minute batch auction. every wallet gets the same price. no front-running, no sniping.",
  },
  {
    icon: "\u26A1",
    title: "skin in the game",
    desc: "deployers stake 2 SOL. refunded only if the token hits 100 holders. aligned incentives from day one.",
  },
  {
    icon: "\u27F3",
    title: "creators earn daily",
    desc: "0.8% of every trade goes to the creator. build community, get paid. every single day.",
  },
  {
    icon: "\u25C7",
    title: "the 1% fee",
    desc: "most creator-friendly split in the market. low enough to trade, high enough to sustain.",
  },
  {
    icon: "\u25B2",
    title: "signal over noise",
    desc: "the feed only shows tokens that survived. no dead launches cluttering your screen.",
  },
  {
    icon: "\u2606",
    title: "prove score",
    desc: "wallet reputation that rewards holding. diamond hands get priority. flippers get filtered.",
  },
];

const FLYWHEEL_STEPS = [
  "creator stakes",
  "batch auction",
  "fair price",
  "trading begins",
  "creator earns",
  "community grows",
  "cycle repeats",
];

const STATS = [
  { value: "$400/day", label: "$50K volume = $400/day for creators" },
  { value: "98.6%", label: "of pump.fun tokens rug" },
  { value: "50 wallets", label: "minimum per batch auction" },
  { value: "72 hrs", label: "milestone window for deployer refund" },
];

export default function LandingPage() {
  return (
    <div className={styles.container}>
      {/* Band 1: Hero */}
      <section className={styles.hero}>
        <h1 className={styles.heroHeading}>
          coins that stick. creators that stay. communities that hold.
        </h1>
        <p className={styles.heroSub}>
          The launchpad where everyone gets the same price. No bots. No
          bundlers. Creators earn by building.
        </p>
        <div className={styles.heroCtas}>
          <Link href="/launch" className={styles.btnPrimary}>
            launch a token
          </Link>
          <Link href="/discover" className={styles.btnOutline}>
            explore tokens
          </Link>
        </div>
        <div className={styles.statsRow}>
          <span className={styles.stat}>50+ wallets per batch</span>
          <span className={styles.stat}>0.8% to creators</span>
          <span className={styles.stat}>5-min fair start</span>
        </div>
      </section>

      {/* Band 2: Section header */}
      <div className={styles.sectionHeaderSage}>
        <p className={styles.kicker}>HOW IT WORKS</p>
        <h2 className={styles.sectionHeading}>
          six mechanics that change the game.
        </h2>
      </div>

      {/* Band 3: Features grid */}
      <div className={styles.featuresGrid}>
        {FEATURES.map((f) => (
          <div key={f.title} className={styles.featureCell}>
            <div className={styles.featureIcon}>{f.icon}</div>
            <h3 className={styles.featureTitle}>{f.title}</h3>
            <p className={styles.featureDesc}>{f.desc}</p>
          </div>
        ))}
      </div>

      {/* Band 4: Section header */}
      <div className={styles.sectionHeaderCream}>
        <p className={styles.kicker}>THE FLYWHEEL</p>
        <h2 className={styles.sectionHeading}>
          every mechanic feeds the next.
        </h2>
      </div>

      {/* Band 5: Flywheel */}
      <section className={styles.flywheel}>
        <div className={styles.flywheelSteps}>
          {FLYWHEEL_STEPS.map((step, i) => (
            <div key={step} style={{ display: "flex", alignItems: "center" }}>
              <div className={styles.flywheelStep}>
                <span className={styles.flywheelStepNumber}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className={styles.flywheelStepLabel}>{step}</span>
              </div>
              {i < FLYWHEEL_STEPS.length - 1 && (
                <span className={styles.flywheelArrow}>{"\u2192"}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Band 6: Stats */}
      <div className={styles.statsBand}>
        {STATS.map((s) => (
          <div key={s.value} className={styles.statCell}>
            <div className={styles.statValue}>{s.value}</div>
            <div className={styles.statLabel}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Band 7: CTA */}
      <section className={styles.ctaBand}>
        <h2 className={styles.ctaHeading}>ready to prove it?</h2>
        <p className={styles.ctaSub}>launch your token with a fair start.</p>
        <Link href="/launch" className={styles.btnWhite}>
          start building
        </Link>
      </section>
    </div>
  );
}
