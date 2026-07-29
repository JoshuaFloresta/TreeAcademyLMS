import { API_URL } from '../../lib/api.js'
import { getBannerPreset } from '../../lib/bannerPresets.js'

export default function CourseBanner({ course, index = 0, children }) {
  if (course?.bannerUrl) {
    const src = course.bannerUrl.startsWith('http') ? course.bannerUrl : `${API_URL}${course.bannerUrl}`
    return <div className="catalog-image has-image" style={{ backgroundImage: `url(${src})` }}>{children}</div>
  }
  const preset = getBannerPreset(course?.bannerPreset, index)
  const Icon = preset.icon
  return <div className="catalog-image preset" style={{ background: preset.gradient }}>{children}<Icon size={34} /></div>
}
