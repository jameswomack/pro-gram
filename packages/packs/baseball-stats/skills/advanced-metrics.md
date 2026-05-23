# Advanced metrics primer (concise)

- **wOBA** — weighted On-Base Average. Like OBP but each event (1B, 2B, HR, BB,
  HBP) gets a run-value weight from linear weights. Scale matches OBP; league
  average ≈ .315 in recent years.
- **xwOBA** — *expected* wOBA from Statcast exit velocity, launch angle, and
  sprint speed. Strips out defense and ballpark. Diverges from wOBA when a
  hitter is BABIP-lucky or unlucky.
- **wRC+** — wOBA scaled to runs created relative to league, park-adjusted.
  100 = average, 150 = 50% better than league. The single best general
  hitting stat.
- **FIP** — Fielding Independent Pitching. ERA-scale estimator using only
  K, BB, HBP, HR. Strips out defense and BABIP luck.
- **xFIP** — FIP with HR/FB normalized to league average. More stable across
  seasons.
- **SIERA** — Skill-Interactive ERA. Like xFIP but also accounts for batted-ball
  profile. Most predictive of the ERA-estimators.
- **Framing runs** — catcher value from stealing strikes outside the zone.
  Top framers add 10–15 runs per season; ignored by traditional fielding
  stats.
- **BABIP** — batting average on balls in play. League ~ .295. Sustained
  outliers above ~.330 or below ~.270 usually regress.
- **Barrel** — Statcast batted-ball classification with high exit-velo × good
  launch angle combo. Barrels/PA is one of the most predictive contact-quality
  rates.
- **Stuff+ / Location+ / Pitching+** — pitch-by-pitch grades on velocity,
  movement, location vs. league. Stuff+ 110 = elite arsenal.
