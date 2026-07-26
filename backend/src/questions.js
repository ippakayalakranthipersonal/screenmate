// Default initial-screening questions. Edit this array to change what
// candidates are asked — no other code changes needed. Order = order shown.
//
// Later, if you want per-role or per-recruiter custom question sets, this
// is the file to turn into a database table instead of a static array.

export const DEFAULT_QUESTIONS = [
  {
    id: "q1",
    prompt: "Tell us a little about yourself and your professional background.",
    maxSeconds: 90,
  },
  {
    id: "q2",
    prompt: "Why are you interested in this role, and in our company?",
    maxSeconds: 90,
  },
  {
    id: "q3",
    prompt: "Walk us through the experience you think is most relevant to this position.",
    maxSeconds: 120,
  },
  {
    id: "q4",
    prompt: "Describe a challenging situation at work and how you handled it.",
    maxSeconds: 120,
  },
  {
    id: "q5",
    prompt: "What are your salary expectations and current notice period?",
    maxSeconds: 60,
  },
];
