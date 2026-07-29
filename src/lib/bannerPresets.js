import { BookOpen, Briefcase, Building2, Compass, Landmark, LineChart, ShieldCheck, Sparkles } from 'lucide-react'

// Ready-to-use catalog-card art. Each preset is a CSS gradient + icon so no image asset is needed;
// instructors can still upload a custom image instead (see CourseBuilderPage banner picker).
export const bannerPresets = [
  { key: 'forest', label: 'Forest', gradient: 'linear-gradient(135deg, #1b432e, #2f6b46)', icon: ShieldCheck },
  { key: 'paper', label: 'Sage', gradient: 'linear-gradient(135deg, #7c8f7f, #c7d3c6)', icon: Compass },
  { key: 'gold', label: 'Gold', gradient: 'linear-gradient(135deg, #a97f2f, #dcb968)', icon: Sparkles },
  { key: 'ocean', label: 'Slate', gradient: 'linear-gradient(135deg, #274255, #4d7290)', icon: Landmark },
  { key: 'clay', label: 'Clay', gradient: 'linear-gradient(135deg, #7a3f2c, #b96a49)', icon: Building2 },
  { key: 'plum', label: 'Plum', gradient: 'linear-gradient(135deg, #402a52, #745594)', icon: Briefcase },
  { key: 'ink', label: 'Ink', gradient: 'linear-gradient(135deg, #1c2430, #3c4a5e)', icon: LineChart },
  { key: 'sand', label: 'Sand', gradient: 'linear-gradient(135deg, #8a7148, #c7a86b)', icon: BookOpen },
]

export const bannerPresetMap = Object.fromEntries(bannerPresets.map((preset) => [preset.key, preset]))

export function getBannerPreset(key, fallbackIndex = 0) {
  return bannerPresetMap[key] ?? bannerPresets[fallbackIndex % bannerPresets.length]
}
