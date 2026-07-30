// The admission form already asks for the things a learner profile wants, so carry them across
// rather than making someone type their school and birthday a second time.
//
// Lives in its own module because both the live provisioning path (server/index.js) and the
// one-off backfill (server/migrate-backfill-profiles.js) need it, and importing index.js would
// boot the whole HTTP server as a side effect.

// Blank fields only. A learner approved for a second pathway must not have the profile they edited
// themselves overwritten by the older intake answers on file.
export function applyIntakeToProfile(user, intakeData) {
  if (!intakeData) return user
  const seed = { birthDate: intakeData.birth_date, school: intakeData.school, degree: intakeData.degree }
  for (const [field, value] of Object.entries(seed)) {
    if (user[field] || !value) continue
    if (field === 'birthDate') {
      const parsed = new Date(value)
      if (!Number.isNaN(parsed.valueOf())) user.birthDate = parsed
      continue
    }
    user[field] = String(value).slice(0, 200)
  }
  return user
}
