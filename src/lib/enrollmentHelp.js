// Self-serve help content for the public enrollment flow. Deliberately static data rather than a
// chat widget or an assistant: every question below has one correct, unchanging answer, and the
// enrollment page is unauthenticated, so anything backed by a paid API would be an open endpoint.
//
// `step` mirrors EnrollmentPage's step numbers (1 admission, 2 agreement, 3 payment, 4 return) so
// the drawer can float the relevant topics to the top. `null` means it applies everywhere.
// `matches` is tested against whatever error the page is currently showing, which is what lets the
// launcher point at the answer instead of waiting to be searched.

export const supportEmail = 'trainwithmastersonline@gmail.com'

export const helpTopics = [
  {
    id: 'required-fields',
    step: 1,
    question: 'It says I left a required field blank, but I can’t find it',
    answer: `Every field marked with a star is required, and the message lists the ones still empty by name.\n\nThe most commonly missed ones aren’t text boxes at all — they’re the tick boxes in sections D and E near the bottom. Every box there has to be ticked except the last one, which is marked optional.\n\nAfter you press Continue the page jumps to the first blank field, so if the screen moves, look right where it lands.`,
    keywords: ['required', 'blank', 'empty', 'missing', 'star', 'asterisk', 'checkbox', 'tick'],
    matches: /required field/i,
  },
  {
    id: 'legal-name',
    step: 1,
    question: 'What name should I put?',
    answer: `Use your full legal name exactly as it appears on your government-issued ID and your PRC records — not a nickname or a shortened version.\n\nThis name is printed on your signed agreement and is what the academy uses to match your records later, so it needs to match your ID. If you normally go by something else, put that in "Preferred name" instead.`,
    keywords: ['name', 'legal', 'id', 'middle', 'nickname', 'spelling'],
  },
  {
    id: 'which-email',
    step: 1,
    question: 'Which email address should I use?',
    answer: `Use an address you actually check. Once your payment is confirmed, the link to set your password is sent there — if it goes to an inbox you can’t open, you won’t be able to sign in.\n\nDouble-check the spelling before you continue. A single wrong letter is the most common reason someone never receives their account email.`,
    keywords: ['email', 'address', 'gmail', 'inbox', 'typo'],
    matches: /valid email address|application email/i,
  },
  {
    id: 'go-back',
    step: 1,
    question: 'Can I go back and change something?',
    answer: `Yes. Use the Back button at the bottom of any step and your answers will still be there — correct what you need and continue again.\n\nThis is also how you fix your name if it’s wrong on the agreement in the next step.`,
    keywords: ['back', 'change', 'edit', 'correct', 'mistake', 'wrong'],
  },
  {
    id: 'documents-not-ready',
    step: 1,
    question: 'I don’t have all my PRC documents yet',
    answer: `That’s fine — those tick boxes are for preliminary screening only and none of them are required to enroll.\n\nTick whatever you already have, then use the "Documents or eligibility concerns" box to explain what’s still pending. Meeting PRC’s own requirements stays your responsibility, and the academy will follow up with you about anything missing.`,
    keywords: ['prc', 'documents', 'diploma', 'transcript', 'tor', 'id', 'eligibility'],
  },
  {
    id: 'signature-name-locked',
    step: 2,
    question: 'The name above the signature line is wrong and I can’t type in it',
    answer: `That box is filled in automatically from your admission form, which is why it can’t be edited here — it has to match the name on your enrollment exactly, or the agreement won’t be valid.\n\nTo change it, press Back, correct your full legal name on the admission form, and continue again. The new name will carry through to the agreement.`,
    keywords: ['signature', 'name', 'locked', 'readonly', 'grey', 'greyed', 'match', 'edit'],
    matches: /signature must match|legal name used for enrollment/i,
  },
  {
    id: 'nothing-happens',
    step: 2,
    question: 'Nothing happens when I press Continue',
    answer: `Something required is still empty, and it’s usually a blank inside the document itself rather than the section below it.\n\nThe page now lists exactly which fields are missing just above the buttons, and jumps to the first one. Scroll through the whole document — the agreement runs over more than one page and it’s easy to miss a box further down.`,
    keywords: ['continue', 'stuck', 'nothing', 'button', 'not working', 'frozen', 'submit'],
  },
  {
    id: 'how-to-sign',
    step: 2,
    question: 'How do I sign?',
    answer: `Draw your signature in the bordered box near the bottom of the page. On a phone or tablet use your finger; on a computer hold the mouse or trackpad button down and draw.\n\nIt doesn’t have to be neat. As you draw, your signature appears on the document above in real time so you can see exactly how it will look. Press Clear to try again as many times as you like.`,
    keywords: ['sign', 'signature', 'draw', 'phone', 'mouse', 'finger', 'clear'],
    matches: /draw your signature/i,
  },
  {
    id: 'exam-type',
    step: 2,
    question: 'Should I tick REBLEX or REALEX?',
    answer: `Tick REBLEX if you're taking the broker licensure examination, and REALEX if you're taking the appraiser one. Only one can be selected.\n\nIf you're not sure which applies to you, email us before signing rather than guessing — the agreement records which examination you're enrolling for.`,
    keywords: ['reblex', 'realex', 'reclex', 'exam', 'broker', 'appraiser', 'tick', 'select'],
    matches: /REBLEX or REALEX/i,
  },
  {
    id: 'keep-a-copy',
    step: 2,
    question: 'Can I keep a copy of what I signed?',
    answer: `Yes. Once you've filled in the document and drawn your signature, press "Download completed PDF" to save a copy before you continue.\n\nA signed copy is also stored with your enrollment record, and the academy can send it to you again later if you need it.`,
    keywords: ['copy', 'download', 'pdf', 'save', 'print', 'record'],
  },
  {
    id: 'payment-options',
    step: 3,
    question: 'What’s the difference between the two payment options?',
    answer: `Paying in full settles the whole program fee in one transaction.\n\nThe reservation option charges only the upfront fee now and holds your slot. The remaining balance is arranged with the academy directly — there’s no second payment button in the app, so someone will coordinate it with you.`,
    keywords: ['payment', 'pay', 'full', 'upfront', 'reservation', 'balance', 'installment', 'price'],
  },
  {
    id: 'paid-no-email',
    step: 4,
    question: 'I paid but haven’t received anything',
    answer: `Give it a few minutes. Your account is created only after the payment provider confirms the transaction back to us, which isn’t instant.\n\nWhen it arrives, the email contains a link to set your own password. Check your spam or promotions folder — it’s the most common place it ends up. If nothing has arrived after a few hours, email us and we’ll resend it.`,
    keywords: ['paid', 'payment', 'email', 'spam', 'password', 'login', 'account', 'waiting'],
  },
  {
    id: 'program-closed',
    step: null,
    question: 'The program I want says it’s closed or opens later',
    answer: `Each program only accepts enrollments during its own intake window, so a closed one can’t be joined even with a direct link.\n\nYou can still pick a different program from the dropdown at the top of the admission form. If you want to be told when the closed one reopens, email us and we’ll let you know.`,
    keywords: ['closed', 'open', 'not open', 'program', 'pathway', 'schedule', 'intake'],
    // Matches both the server's 409 and the two strings blockedPathwayMessage can produce.
    matches: /not currently open|currently closed|enrollment opens/i,
  },
  {
    id: 'session-expired',
    // Filed under the admission form rather than general: it's advice for someone mid-form, and on
    // the landing page it would otherwise greet a visitor who hasn't started anything yet. Only
    // affects ordering — `matches` below still links it to the session error from any step.
    step: 1,
    question: 'I refreshed the page and lost my place',
    answer: `Your answers are held in the browser while you're filling the form, so refreshing or closing the tab partway through will lose them and you'll need to start again.\n\nIt's best to finish in one sitting. Set aside about 15 minutes and have your ID, school details, and PRC status handy before you begin.`,
    keywords: ['refresh', 'reload', 'lost', 'restart', 'expired', 'session', 'closed tab', 'save'],
    matches: /enrollment session is not available|no longer be changed/i,
  },
  {
    id: 'still-stuck',
    step: null,
    question: 'None of this helps — how do I reach a person?',
    answer: `Email us at ${supportEmail} and describe what you were doing when it went wrong.\n\nInclude the name and email address you were enrolling with, and if there was an error message on screen, copy it in. That's usually enough for us to sort it out and reply with what to do next.`,
    keywords: ['help', 'contact', 'support', 'person', 'human', 'email', 'stuck', 'talk'],
  },
]

// Picks the topic that explains whatever error the page is showing, so the launcher can point
// straight at it. Returns null for an unrecognized message rather than guessing.
export const topicForError = (error) => {
  if (!error) return null
  return helpTopics.find((topic) => topic.matches?.test(error)) ?? null
}

const haystack = (topic) => `${topic.question} ${topic.answer} ${topic.keywords.join(' ')}`.toLowerCase()

// Relevant topics for the current step first, then everything else, with an optional text filter
// applied across the question, answer, and keyword list.
export const searchTopics = (query, step) => {
  const trimmed = query.trim().toLowerCase()
  const terms = trimmed ? trimmed.split(/\s+/) : []
  const matching = terms.length
    ? helpTopics.filter((topic) => { const text = haystack(topic); return terms.every((term) => text.includes(term)) })
    : helpTopics
  return {
    onThisStep: matching.filter((topic) => topic.step === step),
    other: matching.filter((topic) => topic.step !== step),
  }
}
