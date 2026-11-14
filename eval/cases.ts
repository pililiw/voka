// Behaviour spec. Each case: [group, text already in the document, keys typed, acceptable results...].
// Special keys: ⌫ Backspace, ⏎ Enter, ⇥ Tab, ⎋ Escape, arrows, ⌥<digit> Option+digit (see harness.ts).
export type Case = [string, string, string, ...string[]];
export const CASES: Case[] = [
  // I-1 a digit that belongs to the token is text: common terms with digits, digit 1 on the typed word,
  // digits where no candidates are shown
  ['I-1', '', 'gpt4 ', 'gpt4 ', 'GPT4 ', 'GPT-4 '],
  ['I-1', '', 'web3 ', 'web3 ', 'Web3 '],
  ['I-1', '', 'user1 ', 'user1 '],
  ['I-1', '', 'sha256 ', 'sha256 ', 'SHA256 '],
  ['I-1', '', 'ipv4 ', 'ipv4 ', 'IPv4 '],
  ['I-1', 'I have ', '2 cats ', '2 cats '],
  ['I-1', 'see you at ', '3pm ', '3pm '],
  // NUM otherwise a digit picks the candidate with that number
  ['NUM', 'I ', 'recom2', 'recommend ', 'recommendation ', 'recommended '],
  ['NUM', '', 'top3', 'topaz ', 'topper '],
  // I-2 unknown words / names / slang must not be silently replaced
  ['I-2', '', 'priya ', 'priya ', 'Priya '],
  ['I-2', 'talked to ', 'olga ', 'olga ', 'Olga '],
  ['I-2', 'ask ', 'ahmed ', 'ahmed ', 'Ahmed '],
  ['I-2', 'call ', 'nguyen ', 'nguyen ', 'Nguyen '],
  ['I-2', 'thanks for ', 'ur ', 'ur ', 'your '],
  ['I-2', 'I left ', 'cuz ', 'cuz ', 'because '],
  ['I-2', 'I use ', 'spotify ', 'spotify ', 'Spotify '],
  ['I-2', 'I read ', 'wikipedia ', 'wikipedia ', 'Wikipedia '],
  // I-3 casing the user typed explicitly is kept
  ['I-3', 'my ', 'iPhone ', 'iPhone '],
  ['I-3', 'push to ', 'GitHub ', 'GitHub '],
  ['I-3', 'works for ', 'NASA ', 'NASA '],
  ['I-3', 'I use ', 'macOS ', 'macOS '],
  // I-4 hyphenated compounds survive
  ['I-4', 'a ', 'well-known ', 'well-known '],
  ['I-4', 'send an ', 'e-mail ', 'e-mail ', 'email '],
  ['I-4', '', 'state-of-the-art ', 'state-of-the-art '],
  // I-5 URLs / emails / paths verbatim
  ['I-5', 'see ', 'https://github.com/foo ', 'https://github.com/foo '],
  ['I-5', 'mail ', 'hello@example.com ', 'hello@example.com '],
  ['I-5', 'open ', '~/projects/app ', '~/projects/app '],
  // I-6 shorthand stays as typed (expansion only via Tab / candidate)
  ['I-6', 'send me the ', 'info ', 'info '],
  ['I-6', 'nice ', 'pic ', 'pic '],
  ['I-6', 'the ', 'max ', 'max '],
  ['I-6', 'the ', 'admin ', 'admin '],
  ['I-6', 'send me the ', 'info⇥', 'information '],
  // I-7 ordinary typos: edit-distance-1 should beat sounds-alike words
  ['I-7', '', 'thier ', 'their '],
  ['I-7', 'the ', 'lenght ', 'length '],
  ['I-7', '', 'retrun ', 'return '],
  ['I-7', 'the ', 'langauge ', 'language '],
  ['I-7', 'the ', 'fucntion ', 'function '],
  ['I-7', 'not ', 'familar ', 'familiar '],
  ['I-7', 'special ', 'ocasion ', 'occasion '],
  ['I-7', 'it is ', 'posible ', 'possible '],
  ['I-7', 'I am ', 'writting ', 'writing '],
  ['I-7', 'we need to ', 'mantain ', 'maintain '],
  ['I-7', 'check the ', 'shedule ', 'schedule '],
  ['I-7', 'the ', 'respone ', 'response '],
  ['I-7', 'I did not ', 'recieve ', 'receive '],
  ['I-7', '', 'teh ', 'the ', 'The '],
  // spelling by sound
  ['KEEP', '', 'bikoz ', 'because '],
  ['KEEP', 'go to ', 'skool ', 'school '],
  ['I-10', 'it is ', 'rili ', 'really '],
  ['KEEP', 'see you ', 'tumoro ', 'tomorrow '],
  ['KEEP', 'it is ', 'nesesari ', 'necessary '],
  ['KEEP', 'I ', 'sajest ', 'suggest '],
  ['KEEP', '', 'zmbie ', 'zombie '],
  ['KEEP', 'see you ', 'tmr ', 'tomorrow '],
  ['KEEP', '', 'pls ', 'please '],
  ['KEEP', '', 'im ', "I'm "],
  ['KEEP', 'see you ', 'tomo⇥', 'tomorrow '],
  ['I-11', 'I ', 'recom⇥', 'recommend '],
  // an unfinished word is not a misspelling: a completion that outscores the best sound-alike wins
  ['I-11', 'He goes to ', 'recom⇥', 'recommend '],
  ['I-11', 'He goes to ', 'recom ', 'recom '],
  ['KEEP', '', 'teh ⌫', 'the'],
  ['KEEP', '', 'thier⏎', 'thier'],
  // Enter while composing only confirms the letters ; the next Enter is the app's
  ['KEEP', '', 'thier⏎⏎', 'thier\n'],
  ['KEEP', 'ok ', 'thx⏎', 'thx'],
  ['KEEP', 'ok ', 'thx ', 'thanks '],
  ['UX', '', 'bhvr.', 'behavior.'],
  ['UX', '', 'bhvr,', 'behavior,'],
  ['UX', '', 'bhvr.com ', 'bhvr.com '],
  ['KEEP', 'she has ', 'a apple ', 'an apple '],
  ['KEEP', 'Yesterday I ', 'go ', 'went '],
  ['KEEP', 'he ', 'go ', 'goes '],
  ['KEEP', 'there are many ', 'person ', 'people '],
  ['KEEP', 'use ', 'json ', 'JSON '],
  // I-8 date / unit / currency abbreviations
  ['I-8', 'the deadline is ', 'nov 20', 'nov 20', 'Nov 20'],
  ['I-8', 'since ', 'jan ', 'jan ', 'Jan '],
  ['I-8', 'on ', 'wed ', 'wed ', 'Wed '],
  ['I-8', 'on ', 'fri ', 'fri ', 'Fri '],
  ['I-8', '100 ', 'usd ', 'usd ', 'USD '],
  ['I-8', '500 ', 'eur ', 'eur ', 'EUR '],
  ['I-8', '10 ', 'kg ', 'kg '],
  // I-9 third-person-singular agreement is consistent
  ['I-9', 'she ', 'like ', 'likes '],
  ['I-9', 'it ', 'work ', 'works '],
  ['I-9', 'the user ', 'want ', 'wants '],
  ['I-9', 'my boss ', 'need ', 'needs '],
  // SLIP: one obvious slip of the hand on a very frequent word is fixed on Space, even on short tokens
  // (neighbouring key, swapped letters, dropped or doubled letter) - but only when nothing else comes close.
  ['SLIP', 'salt ', 'anf pepper ', 'and pepper '],
  ['SLIP', 'tell me ', 'whn ', 'when '],
  ['SLIP', 'it ', 'wil work ', 'will work '],
  ['SLIP', 'they ', 'arte here ', 'are here '],
  // ...two frequent words equally close: nothing is replaced (Tab offers one)
  ['SLIP', 'over ', 'ther ', 'ther '],
  ['SLIP', 'I think ', 'thay ', 'thay '],
  ['SLIP', 'and ', 'noe ', 'noe '],
  // ...short tokens that are things people type on purpose stay
  ['SLIP', 'us ', 'vs them ', 'vs them '],
  ['SLIP', 'and so on ', 'etc ', 'etc '],
  ['SLIP', 'see you, ', 'bro ', 'bro '],
  ['SLIP', 'on ', 'tv ', 'tv ', 'TV '],
  ['SLIP', 'a ', 'gif ', 'gif ', 'GIF '],
  ['SLIP', 'oh ', 'lol ', 'lol '],
  ['SLIP', 'the ', 'faq ', 'faq ', 'FAQ '],
  ['SLIP', 'my ', 'cuz ', 'cuz '],
  // GRAM: grammar corrections change correctly spelled words, so they must be certain. Bare verbs after
  // causatives / perception verbs / mandative verbs, elliptical questions, do-support and relative
  // clauses stay as typed.
  ['GRAM', 'I suggest he ', 'take the offer ', 'take the offer '],
  ['GRAM', 'the speech made everyone ', 'cry ', 'cry '],
  ['GRAM', '', 'Anyone know why ', 'Anyone know why '],
  ['GRAM', 'patients who ', 'need surgery ', 'need surgery '],
  ['GRAM', 'Did she go ahead and ', 'approve it ', 'approve it '],
  ['GRAM', 'the upstream bug ', '(see below) ', '(see below) '],
  ['GRAM', 'I think ', 'he go home ', 'he goes home '],
  ['GRAM', '', 'The client want it ', 'The client wants it '],
  ['GRAM', 'The client ', 'dont care ', "doesn't care "],
  // a singular noun after a quantifier is often a modifier: a regular plural is only suggested (Tab),
  // and a word that is already committed is never changed afterwards
  ['GRAM', 'we got many ', 'customer support tickets ', 'customer support tickets '],
  ['GRAM', 'check those ', 'user accounts ', 'user accounts '],
  ['GRAM', 'on the number 12 ', 'bus today ', 'bus today '],
  ['GRAM', 'I have two ', 'book in my bag ', 'book in my bag '],
  ['GRAM', 'I have two ', 'book⇥', 'books '],
  ['GRAM', 'there are many ', 'student and teachers ', 'student and teachers '],
  ['GRAM', 'there are three ', 'child here ', 'children here '],
  // a regular ending on an irregular word
  ['GRAM', 'We ', 'goed home ', 'went home '],
  ['GRAM', 'she has ', 'goed home ', 'gone home '],
  ['GRAM', 'I ', 'buyed it ', 'bought it '],
  ['GRAM', 'for three ', 'monthes ', 'months '],
  ['GRAM', 'some useful ', 'informations ', 'information '],
  // WORLD: British spellings, derived words and food words from other languages are words
  ['WORLD', 'political ', 'polarisation ', 'polarisation '],
  ['WORLD', 'the ', 'enrolment form ', 'enrolment form '],
  ['WORLD', 'time marches ', 'inexorably on ', 'inexorably on '],
  ['WORLD', 'a bit ', 'rubbery ', 'rubbery '],
  ['WORLD', 'the best ', 'paella ', 'paella '],
  ['WORLD', 'mother cooks ', 'biryani ', 'biryani '],
  // SLIP2: the form one slip away, sound twins, and no magnetism from a far sound-alike
  ['SLIP2', 'he ', 'comea⇥', 'comes '],
  ['SLIP2', 'two ', 'bottlencks ', 'bottlenecks '],
  ['SLIP2', 'it is ', 'wery⇥', 'very '],
  ['SLIP2', 'the right ', 'bookk ', 'bookk '],
  ['SLIP2', 'it takes ', 'roughyl ', 'roughyl '],
  ['SLIP2', 'do you have ', 'opn ', 'opn '],
];

// Wanted behaviour the engine does not deliver yet. Reported by replay.ts, never counted as failures.
export const KNOWN_GAPS: Case[] = [
  // short spellings by sound that are one letter away from a frequent word: Space keeps the letters, and
  // the target is among the candidates but not the first suggestion
  ['I-10', 'my ', 'fone ', 'phone '],
  ['I-10', 'take a ', 'foto ', 'photo '],
  ['I-10', '', 'enuf ', 'enough '],
];
