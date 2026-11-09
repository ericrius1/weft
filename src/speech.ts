// Speech for the cast (and the townsfolk): text -> phonemes -> a timed line, and the mouth along it. No audio or DOM
// here (voice.ts sings the same line, talk.ts plays it and shows its words); everything is deterministic, so a film
// renders the same mouth every time.
//
// - Phonemes: a small dictionary (the cast's names, the irregular words) over the Naval Research Laboratory's
//   letter-to-sound rules (Elovitz, Johnson, McHugh and Shore, 1976: context rules per letter, in the public domain),
//   with a rough stress (the first syllable, or the second after a light prefix; function words reduced).
// - The line: each phoneme timed by its own length (Klatt's inherent durations, stressed vowels longer, the last syllable
//   of a phrase drawn out), pauses at commas and full stops, scaled by the speaker's rate.
// - The mouth: each phoneme's viseme (the 15 of the Oculus / MPEG-4 set: closed for p b m, the lip under the teeth for
//   f v, the tongue's tip for th l n...) as a target, blended through time by Cohen and Massaro's dominance model of
//   coarticulation: every segment pulls the mouth toward its own shape with a strength that falls off away from its
//   middle, the lips' closures and the rounded vowels strongly (they must be seen), the tongue's consonants weakly (they
//   take their neighbours' shapes). That gives the anticipation and the smoothing real mouths have.

export type Phone =
  | 'AA' | 'AE' | 'AH' | 'AO' | 'AW' | 'AX' | 'AY' | 'EH' | 'ER' | 'EY' | 'IH' | 'IY' | 'OW' | 'OY' | 'UH' | 'UW'
  | 'B' | 'CH' | 'D' | 'DH' | 'F' | 'G' | 'HH' | 'JH' | 'K' | 'L' | 'M' | 'N' | 'NG' | 'P' | 'R' | 'S' | 'SH' | 'T'
  | 'TH' | 'V' | 'W' | 'Y' | 'Z' | 'ZH' | '_';

export const VOWELS = new Set<Phone>(['AA', 'AE', 'AH', 'AO', 'AW', 'AX', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW']);

/** a timed phoneme: its start and end (s, from the line's start), its stress (0 none, 1 secondary, 2 primary), its
 *  word (index), and the pitch's shape over its phrase (0 at the phrase's start .. 1 at its end) */
export interface TimedPhone { p: Phone; t0: number; t1: number; stress: number; word: number; phrase: number; end: '.' | '?' | '!' | ',' | '' }
export interface TimedWord { text: string; t0: number; t1: number; /** where it is in the line's text */ i0: number; i1: number }
export interface Timeline {
  text: string; phones: TimedPhone[]; words: TimedWord[]; dur: number; question: boolean; exclaim: boolean;
  /** a recorded line's loudness (cast/voicepack.ts): `rate` frames a second, each 0..255 over -50..-10 dBFS; the jaw
   *  opens with it, and a sound with no word (a laugh, a breath) still parts the lips */
  env?: { rate: number; v: Uint8Array };
}

// ---------------------------------------------------------------- the dictionary
// (ARPAbet, a 1 after the stressed vowel; words in capitals)
const DICT: Record<string, string> = {
  A: 'AX', AN: 'AE N', AND: 'AE N D', ARE: 'AA R', AS: 'AE Z', AT: 'AE T', BE: 'B IY', BUT: 'B AH T', BY: 'B AY', CAN: 'K AE N',
  DO: 'D UW', DOES: 'D AH Z', FOR: 'F AO R', FROM: 'F R AH M', HAD: 'HH AE D', HAS: 'HH AE Z', HAVE: 'HH AE V', HE: 'HH IY',
  HER: 'HH ER', HIS: 'HH IH Z', I: 'AY', IF: 'IH F', IN: 'IH N', IS: 'IH Z', IT: 'IH T', ITS: 'IH T S', ME: 'M IY', MY: 'M AY',
  NO: 'N OW', NOT: 'N AA T', OF: 'AH V', ON: 'AA N', ONE: 'W AH N', OR: 'AO R', OUR: 'AW ER', SHE: 'SH IY', SO: 'S OW',
  THE: 'DH AX', THEY: 'DH EY', THIS: 'DH IH S', TO: 'T UW', TWO: 'T UW', US: 'AH S', WAS: 'W AH Z', WE: 'W IY', WERE: 'W ER',
  WHAT: 'W AH T', WHO: 'HH UW', WHY: 'W AY', WITH: 'W IH DH', YOU: 'Y UW', YOUR: 'Y AO R', OH: 'OW', AH: 'AA', HMM: 'HH M',
  MM: 'M', OK: 'OW K EY', OKAY: 'OW K EY', HI: 'HH AY', HEY: 'HH EY', HELLO: 'HH AX L OW', YES: 'Y EH S', YEAH: 'Y EH AX',
  WOW: 'W AW', OOH: 'UW', AW: 'AO', HA: 'HH AA', HAHA: 'HH AA HH AA', THANKS: 'TH AE NG K S', PLEASE: 'P L IY Z',
  SAID: 'S EH D', SAYS: 'S EH Z', SOME: 'S AH M', COME: 'K AH M', DONE: 'D AH N', GONE: 'G AO N', LOVE: 'L AH V',
  GIVE: 'G IH V', LIVE: 'L IH V', ONCE: 'W AH N S', ANY: 'EH N IY', MANY: 'M EH N IY', AGAIN: 'AX G EH N', BEEN: 'B IH N',
  BUSY: 'B IH Z IY', COULD: 'K UH D', WOULD: 'W UH D', SHOULD: 'SH UH D', EYE: 'AY', EYES: 'AY Z', HEART: 'HH AA R T',
  FRIEND: 'F R EH N D', FRIENDS: 'F R EH N D Z', PEOPLE: 'P IY P AX L', WATER: 'W AO T ER', TEA: 'T IY', CUP: 'K AH P',
  JASMINE: 'JH AE Z M IH N', GINSENG: 'JH IH N S EH NG', LEAVES: 'L IY V Z', WARM: 'W AO R M', MOUNTAIN: 'M AW N T AX N',
  MOUNTAINS: 'M AW N T AX N Z', BEAUTIFUL: 'B Y UW T IH F AX L', THROUGH: 'TH R UW', THOUGH: 'DH OW', ENOUGH: 'IH N AH F',
  TONIGHT: 'T AX N AY T', TODAY: 'T AX D EY', TOMORROW: 'T AX M AA R OW', NIGHT: 'N AY T', LIGHT: 'L AY T', STARS: 'S T AA R Z',
  SKY: 'S K AY', MOON: 'M UW N', FIRE: 'F AY ER', AIR: 'EH R', EARTH: 'ER TH', BALANCE: 'B AE L AX N S', UNCLE: 'AH NG K AX L',
  KATARA: 'K AX T AA1 R AX', AANG: 'AA1 NG', IROH: 'AY1 R OW', SOKKA: 'S AA1 K AX', APPA: 'AA1 P AX', MOMO: 'M OW1 M OW',
  ZUKO: 'Z UW1 K OW', TOPH: 'T OW1 F', AVATAR: 'AE1 V AX T AA R', BOULDER: 'B OW1 L D ER', FLATIRONS: 'F L AE1 T AY ER N Z',
  PEARL: 'P ER L', COLORADO: 'K AA L ER AA1 D OW', AIRBENDING: 'EH1 R B EH N D IH NG',
  WATERBENDING: 'W AO1 T ER B EH N D IH NG', FIREBENDING: 'F AY1 ER B EH N D IH NG', BENDER: 'B EH1 N D ER',
  DON: 'D OW N', "DON'T": 'D OW N T', "CAN'T": 'K AE N T', "WON'T": 'W OW N T', "ISN'T": 'IH Z AX N T', "DIDN'T": 'D IH D AX N T',
  "I'M": 'AY M', "I'LL": 'AY L', "I'VE": 'AY V', "I'D": 'AY D', "YOU'RE": 'Y UH R', "YOU'LL": 'Y UW L', "IT'S": 'IH T S',
  "THAT'S": 'DH AE T S', "LET'S": 'L EH T S', "WHAT'S": 'W AH T S', "THERE'S": 'DH EH R Z', "HERE'S": 'HH IY R Z',
  "WE'RE": 'W IY R', "THEY'RE": 'DH EH R', "HE'S": 'HH IY Z', "SHE'S": 'SH IY Z', "AREN'T": 'AA R AX N T', "WASN'T": 'W AH Z AX N T',
  "DOESN'T": 'D AH Z AX N T', "COULDN'T": 'K UH D AX N T', "WOULDN'T": 'W UH D AX N T', "SHOULDN'T": 'SH UH D AX N T',
  "Y'KNOW": 'Y AX N OW', "MA'AM": 'M AE M', "O'CLOCK": 'AX K L AA K',
  ANSWER: 'AE1 N S ER', WANT: 'W AA1 N T', WANTS: 'W AA1 N T S', WANTED: 'W AA1 N T IH D', MAYBE: 'M EY1 B IY', HOUSE: 'HH AW1 S',
  ALWAYS: 'AO1 L W EY Z', TOGETHER: 'T AX G EH1 DH ER', SECOND: 'S EH1 K AX N D', SOMETIMES: 'S AH1 M T AY M Z', WATCH: 'W AA1 CH',
  WARMER: 'W AO1 R M ER', OCEAN: 'OW1 SH AX N', LISTEN: 'L IH1 S AX N', OFTEN: 'AO1 F AX N', WOMAN: 'W UH1 M AX N',
  BUILD: 'B IH1 L D', MOVE: 'M UW1 V', PRETTY: 'P R IH1 T IY', BREAKFAST: 'B R EH1 K F AX S T', AUTUMN: 'AO1 T AX M',
  BREWED: 'B R UW1 D', FAVOURITE: 'F EY1 V R IH T', FAVORITE: 'F EY1 V R IH T', FIREFLIES: 'F AY1 ER F L AY Z', FIXES: 'F IH1 K S IH Z',
  FIX: 'F IH1 K S', HURRIES: 'HH ER1 IY Z', LOVELIER: 'L AH1 V L IY ER', MODERATION: 'M AA D ER EY1 SH AX N', MOMENT: 'M OW1 M AX N T',
  OPENED: 'OW1 P AX N D', OPINIONS: 'AX P IH1 N Y AX N Z', PARTIES: 'P AA1 R T IY Z', QUIET: 'K W AY1 AX T', SCUSE: 'S K Y UW1 Z',
  SOMEONE: 'S AH1 M W AH N', WIND: 'W IH1 N D', YOURSELF: 'Y AO R S EH1 L F', EVERYONE: 'EH1 V R IY W AH N', KINDNESS: 'K AY1 N D N AX S',
  DISAGREE: 'D IH S AX G R IY1', ABOUT: 'AX B AW1 T', AHEAD: 'AX HH EH1 D', BREAK: 'B R EY1 K', BEDTIME: 'B EH1 D T AY M',
  COMPANY: 'K AH1 M P AX N IY', BROWS: 'B R AW Z', TEAPOT: 'T IY1 P AA T', GOODNIGHT: 'G UH D N AY1 T', SIX: 'S IH1 K S', MIX: 'M IH1 K S',
  HONEY: 'HH AH1 N IY', MONEY: 'M AH1 N IY', OTHER: 'AH1 DH ER', MOTHER: 'M AH1 DH ER', BROTHER: 'B R AH1 DH ER', NOTHING: 'N AH1 TH IH NG',
};
/** words said lightly (no stress, the vowel reduced): the little words between the ones that carry a line */
const LIGHT = new Set(['A', 'AN', 'AND', 'ARE', 'AS', 'AT', 'BE', 'BUT', 'BY', 'CAN', 'FOR', 'FROM', 'HAD', 'HAS', 'HAVE', 'HE', 'HER', 'HIS',
  'IF', 'IN', 'IS', 'IT', 'ITS', 'ME', 'MY', 'OF', 'ON', 'OR', 'OUR', 'SHE', 'SO', 'THE', 'THEY', 'TO', 'US', 'WAS', 'WE', 'WERE', 'WITH',
  'YOU', 'YOUR', 'THAT', 'THAN', 'THEN', 'THEM', 'WOULD', 'COULD', 'SHOULD', 'JUST', 'SOME', 'BEEN', 'DO', 'DOES', 'WILL']);

// ---------------------------------------------------------------- the letter-to-sound rules (NRL 1976)
// "left[body]right=phonemes", per letter. Contexts: ' ' a word's edge, '#' one or more vowels, ':' zero or more
// consonants, '^' one consonant, '.' a voiced consonant, '+' a front vowel (E I Y), '%' a suffix (ER E ES ED ING ELY),
// '&' a sibilant (S C G Z X J CH SH), '@' T S R D L Z N J TH CH SH; anything else literally.
const RULES_SRC: Record<string, string[]> = {
  A: [' [A] =AX', ' [ARE] =AA R', ' [AR]O=AX R', '[AR]#=EH R', '^[AS]#=EY S', '[A]WA=AX', '[AW]=AO', ' :[ANY]=EH N IY', '[A]^+#=EY',
    '#:[ALLY]=AX L IY', ' [AL]#=AX L', '[AGAIN]=AX G EH N', '#:[AG]E=IH JH', '[A]^+:#=AE', ' :[A]^+ =EY', '[A]^%=EY', ' [ARR]=AX R',
    '[ARR]=AE R', ' :[AR] =AA R', '[AR] =ER', '[AR]=AA R', '[AIR]=EH R', '[AI]=EY', '[AY]=EY', '[AU]=AO', '#:[AL] =AX L',
    '#:[ALS] =AX L Z', '[ALK]=AO K', '[AL]^=AO L', ' :[ABLE]=EY B AX L', '[ABLE]=AX B AX L', '[ANG]+=EY N JH', '[A]=AE'],
  B: [' [BE]^#=B IH', '[BEING]=B IY IH NG', ' [BOTH] =B OW TH', ' [BUS]#=B IH Z', '[BUIL]=B IH L', '[B]=B'],
  C: [' [CH]^=K', '^E[CH]=K', '[CH]=CH', ' S[CI]#=S AY', '[CI]A=SH', '[CI]O=SH', '[CI]EN=SH', '[C]+=S', '[CK]=K', '[COM]%=K AH M', '[C]=K'],
  D: ['#:[DED] =D IH D', '.E[D] =D', '#:^E[D] =T', ' [DE]^#=D IH', ' [DO] =D UW', ' [DOES]=D AH Z', ' [DOING]=D UW IH NG', ' [DOW]=D AW',
    '[DU]A=JH UW', '[D]=D'],
  E: ['#:[E] =', "'^:[E] =", ' :[E] =IY', '#[ED] =D', '#:[E]D =', '[EV]ER=EH V', '[E]^%=IY', '[ERI]#=IY R IY', '[ERI]=EH R IH',
    '#:[ER]#=ER', '[ER]#=EH R', '[ER]=ER', ' [EVEN]=IY V EH N', '#:[E]W=', '@[EW]=UW', '[EW]=Y UW', '[E]O=IY', '#:&[ES] =IH Z',
    '#:[E]S =', '#:[ELY] =L IY', '#:[EMENT]=M EH N T', '[EFUL]=F UH L', '[EE]=IY', '[EARN]=ER N', ' [EAR]^=ER', '[EAD]=EH D',
    '#:[EA] =IY AX', '[EA]SU=EH', '[EA]=IY', '[EIGH]=EY', '[EI]=IY', ' [EYE]=AY', '[EY]=IY', '[EU]=Y UW', '[E]=EH'],
  F: ['[FUL]=F UH L', '[F]=F'],
  G: ['[GIV]=G IH V', ' [G]I^=G', '[GE]T=G EH', 'SU[GGES]=G JH EH S', '[GG]=G', ' B#[G]=G', '[G]+=JH', '[GREAT]=G R EY T', '#[GH]=', '[G]=G'],
  H: [' [HAV]=HH AE V', ' [HERE]=HH IY R', ' [HOUR]=AW ER', '[HOW]=HH AW', '[H]#=HH', '[H]='],
  I: [' [IN]=IH N', ' [I] =AY', '[IN]D=AY N', '[IER]=IY ER', '#:R[IED]=IY D', '[IED] =AY D', '[IEN]=IY EH N', '[IE]T=AY EH',
    ' :[I]%=AY', '[I]%=IY', '[IE]=IY', '[I]^+:#=IH', '[IR]#=AY R', '[IZ]%=AY Z', '[IS]%=AY Z', '[I]D%=AY', '+^[I]^+=IH',
    '[I]T%=AY', '#:^[I]^+=IH', '[I]^+=AY', '[IR]=ER', '[IGH]=AY', '[ILD]=AY L D', '[IGN] =AY N', '[IGN]^=AY N', '[IGN]%=AY N', '[IQUE]=IY K', '[I]=IH'],
  J: ['[J]=JH'],
  K: [' [K]N=', '[K]=K'],
  L: ['[LO]C#=L OW', 'L[L]=', '#:^[L]%=AX L', '[LEAD]=L IY D', '[L]=L'],
  M: ['[MOV]=M UW V', '[M]=M'],
  N: ['E[NG]+=N JH', '[NG]R=NG G', '[NG]#=NG G', '[NGL]%=NG G AX L', '[NG]=NG', '[NK]=NG K', ' [NOW] =N AW', '[N]=N'],
  O: ['[OF] =AX V', '[OROUGH]=ER OW', '#:[OR] =ER', '#:[ORS] =ER Z', '[OR]=AO R', ' [ONE]=W AH N', '[OW]=OW', ' [OVER]=OW V ER',
    '[OV]=AH V', '[O]^%=OW', '[O]^EN=OW', '[O]^I#=OW', '[OL]D=OW L', '[OUGHT]=AO T', '[OUGH]=AH F', ' [OU]=AW', 'H[OU]S#=AW',
    '[OUS]=AX S', '[OUR]=AO R', '[OULD]=UH D', '^[OU]^L=AH', '[OUP]=UW P', '[OU]=AW', '[OY]=OY', '[OING]=OW IH NG', '[OI]=OY',
    '[OOR]=AO R', '[OOK]=UH K', '[OOD]=UH D', '[OO]=UW', '[O]E=OW', '[O] =OW', '[OA]=OW', ' [ONLY]=OW N L IY', ' [ONCE]=W AH N S',
    "[ON'T]=OW N T", 'C[O]N=AA', '[O]NG=AO', ' :^[O]N=AH', 'I[ON]=AX N', '#:[ON] =AX N', '#^[ON]=AX N', '[O]ST =OW', '[OF]^=AO F',
    '[OTHER]=AH DH ER', '[OSS] =AO S', '#:^[OM]=AH M', '[O]=AA'],
  P: ['[PH]=F', '[PEOP]=P IY P', '[POW]=P AW', '[PUT] =P UH T', '[P]=P'],
  Q: ['[QUAR]=K W AO R', '[QU]=K W', '[Q]=K'],
  R: [' [RE]^#=R IY', '[R]=R'],
  S: ['[SH]=SH', '#[SION]=ZH AX N', '[SOME]=S AH M', '#[SUR]#=ZH ER', '[SUR]#=SH ER', '#[SU]#=ZH UW', '#[SSU]#=SH UW', '#[SED] =Z D',
    '#[S]#=Z', '[SAID]=S EH D', '^[SION]=SH AX N', '[S]S=', '.[S] =Z', '#:.E[S] =Z', '#:^##[S] =Z', '#:^#[S] =S', 'U[S] =S',
    ' :#[S] =Z', ' [SCH]=S K', '[S]C+=', '#[SM]=Z M', "#[SN]'=Z AX N", '[S]=S'],
  T: [' [THE] =DH AX', '[TO] =T UW', '[THAT] =DH AE T', ' [THIS] =DH IH S', ' [THEY]=DH EY', ' [THERE]=DH EH R', '[THER]=DH ER',
    '[THEIR]=DH EH R', ' [THAN] =DH AE N', ' [THEM] =DH EH M', '[THESE] =DH IY Z', ' [THEN]=DH EH N', '[THROUGH]=TH R UW',
    '[THOSE]=DH OW Z', '[THOUGH] =DH OW', ' [THUS]=DH AH S', '[TH]=TH', '#:[TED] =T IH D', 'S[TI]#N=CH', '[TI]O=SH', '[TI]A=SH',
    '[TIEN]=SH AX N', '[TUR]#=CH ER', '[TU]A=CH UW', ' [TWO]=T UW', '[T]=T'],
  U: [' [UN]I=Y UW N', ' [UN]=AH N', ' [UPON]=AX P AO N', '@[UR]#=UH R', '[UR]#=Y UH R', '[UR]=ER', '[U]^ =AH', '[U]^^=AH', '[UY]=AY',
    ' G[U]#=', 'G[U]%=', 'G[U]#=W', '#N[U]=Y UW', '@[U]=UW', '[U]=Y UW'],
  V: ['[VIEW]=V Y UW', '[V]=V'],
  W: [' [WERE]=W ER', '[WA]S=W AA', '[WA]T=W AA', '[WHERE]=W EH R', '[WHAT]=W AA T', '[WHOL]=HH OW L', '[WHO]=HH UW', '[WH]=W',
    '[WAR]=W AO R', '[WOR]^=W ER', '[WR]=R', '[W]=W'],
  X: ['[X]=K S'],
  Y: ['[YOUNG]=Y AH NG', ' [YOU]=Y UW', ' [YES]=Y EH S', ' [Y]=Y', '#:^[Y] =IY', '#:^[Y]I=IY', ' :[Y] =AY', ' :[Y]#=AY', ' :[Y]^+:#=IH',
    ' :[Y]^#=AY', '[Y]=IH'],
  Z: ['[Z]=Z'],
  "'": ["[']="],
};
interface Rule { left: string; body: string; right: string; out: Phone[] }
const RULES: Record<string, Rule[]> = {};
for (const [k, list] of Object.entries(RULES_SRC)) {
  RULES[k] = list.map((s) => {
    const a = s.indexOf('['), b = s.indexOf(']'), e = s.indexOf('=', b);
    return { left: s.slice(0, a), body: s.slice(a + 1, b), right: s.slice(b + 1, e), out: s.slice(e + 1).split(' ').filter(Boolean) as Phone[] };
  });
}
const isV = (c: string) => c === 'A' || c === 'E' || c === 'I' || c === 'O' || c === 'U';
const isC = (c: string) => c >= 'A' && c <= 'Z' && !isV(c);
const VOICED = 'BDVGJLMNRWZ';
/** the right context at i (forward): true if it matches */
function rightOk(pat: string, w: string, i: number): boolean {
  for (let k = 0; k < pat.length; k++) {
    const c = pat[k];
    if (c === '#') { if (!isV(w[i] ?? '')) return false; while (isV(w[i] ?? '')) i++; }
    else if (c === ':') { while (isC(w[i] ?? '')) i++; }
    else if (c === '^') { if (!isC(w[i] ?? '')) return false; i++; }
    else if (c === '.') { if (!VOICED.includes(w[i] ?? '_')) return false; i++; }
    else if (c === '+') { const x = w[i] ?? ''; if (x !== 'E' && x !== 'I' && x !== 'Y') return false; i++; }
    else if (c === '%') {
      // ER E ES ED ING ELY (the longest)
      if (w.startsWith('ING', i)) i += 3;
      else if (w.startsWith('ELY', i)) i += 3;
      else if (w.startsWith('ER', i) || w.startsWith('ES', i) || w.startsWith('ED', i)) i += 2;
      else if (w[i] === 'E') i += 1;
      else return false;
    } else { if (w[i] !== c) return false; i++; }
  }
  return true;
}
/** the left context ending at i (backward) */
function leftOk(pat: string, w: string, i: number): boolean {
  for (let k = pat.length - 1; k >= 0; k--) {
    const c = pat[k];
    if (c === '#') { if (!isV(w[i] ?? '')) return false; while (isV(w[i] ?? '')) i--; }
    else if (c === ':') { while (isC(w[i] ?? '')) i--; }
    else if (c === '^') { if (!isC(w[i] ?? '')) return false; i--; }
    else if (c === '.') { if (!VOICED.includes(w[i] ?? '_')) return false; i--; }
    else if (c === '+') { const x = w[i] ?? ''; if (x !== 'E' && x !== 'I' && x !== 'Y') return false; i--; }
    else if (c === '&') {
      const x = w[i] ?? '';
      if ('SCGZXJ'.includes(x) && x) i--;
      else if (x === 'H' && (w[i - 1] === 'C' || w[i - 1] === 'S')) i -= 2;
      else return false;
    } else if (c === '@') {
      const x = w[i] ?? '';
      if ('TSRDLZNJ'.includes(x) && x) i--;
      else if (x === 'H' && 'TCS'.includes(w[i - 1] ?? '_')) i -= 2;
      else return false;
    } else { if (w[i] !== c) return false; i--; }
  }
  return true;
}
/** a word's phonemes by the rules (no stress) */
function byRules(word: string): Phone[] {
  const w = ` ${word} `;
  const out: Phone[] = [];
  let i = 1;
  while (i < w.length - 1) {
    const list = RULES[w[i]];
    if (!list) { i++; continue; }
    let hit = false;
    for (const r of list) {
      if (!w.startsWith(r.body, i)) continue;
      if (!leftOk(r.left, w, i - 1) || !rightOk(r.right, w, i + r.body.length)) continue;
      out.push(...r.out);
      i += r.body.length;
      hit = true;
      break;
    }
    if (!hit) i++;
  }
  // (a doubled consonant is one sound: happy, little)
  return out.filter((p, k) => k === 0 || p !== out[k - 1] || VOWELS.has(p));
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function numberWords(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numberWords(n % 100) : '');
  if (n < 1e6) return numberWords(Math.floor(n / 1000)) + ' thousand' + (n % 1000 ? ' ' + numberWords(n % 1000) : '');
  return String(n).split('').map((d) => ONES[+d]).join(' ');
}

/** a word's phonemes with stress marks (a 1 or 2 after a stressed vowel: 2 the word's main one) */
export function wordPhones(word: string): { p: Phone; stress: number }[] {
  const W = word.toUpperCase().replace(/[’‘]/g, "'").replace(/[^A-Z']/g, '');
  if (!W) return [];
  const d = DICT[W];
  const light = LIGHT.has(W);
  if (d) {
    const toks = d.split(' ');
    const marked = toks.some((t) => /\d$/.test(t));
    let first = true;
    return toks.map((t) => {
      const p = t.replace(/\d$/, '') as Phone;
      let stress = 0;
      if (VOWELS.has(p)) {
        if (marked) stress = /1$/.test(t) ? 2 : 0;
        else if (first && !light) stress = 2;
        first = false;
      }
      return { p, stress };
    });
  }
  // ('S, 'LL, 'RE, 'VE, 'D, 'M, N'T: the rules read the apostrophe as nothing, the letters after it as they sound)
  const ph = byRules(W);
  // stress: the first vowel, or the second after a light prefix
  const vi: number[] = [];
  ph.forEach((p, i) => { if (VOWELS.has(p)) vi.push(i); });
  let s = vi[0];
  if (vi.length > 1 && /^(A|BE|DE|RE|PRE|CON|COM|EX|TO|FOR|UN|IN|EN|EM)[^AEIOU]/.test(W) && ph[vi[0]] !== 'AE') s = vi[1];
  return ph.map((p, i) => ({ p, stress: light ? 0 : i === s ? 2 : 0 }));
}

// ---------------------------------------------------------------- timing
/** each phoneme's own length (s): Klatt's inherent durations, a little brisker */
const DUR: Record<Phone, number> = {
  AA: 0.15, AE: 0.14, AH: 0.1, AO: 0.15, AW: 0.18, AX: 0.06, AY: 0.18, EH: 0.11, ER: 0.13, EY: 0.15, IH: 0.09, IY: 0.12, OW: 0.15,
  OY: 0.19, UH: 0.09, UW: 0.13,
  B: 0.065, CH: 0.1, D: 0.055, DH: 0.045, F: 0.09, G: 0.065, HH: 0.06, JH: 0.09, K: 0.075, L: 0.065, M: 0.075, N: 0.06, NG: 0.075,
  P: 0.08, R: 0.065, S: 0.1, SH: 0.1, T: 0.07, TH: 0.09, V: 0.06, W: 0.06, Y: 0.055, Z: 0.08, ZH: 0.08, _: 0.1,
};

export interface LineOpts {
  /** speech rate (1 normal; Iroh's easy 0.86, Aang's quick 1.12) */
  rate?: number;
  /** a little silence before the first word (s) */
  lead?: number;
}

/** a line of text said: its phonemes on a clock, its words and where they are in the text */
export function lineOf(text: string, o: LineOpts = {}): Timeline {
  const rate = o.rate ?? 1;
  const phones: TimedPhone[] = [];
  const words: TimedWord[] = [];
  let t = o.lead ?? 0.05;
  // the words and the punctuation between them (numbers spelt out)
  const re = /(\d+)|([A-Za-z’‘'][A-Za-z’‘'-]*)|([.?!,;:…—–-]+)/g;
  let m: RegExpExecArray | null;
  type Tok = { word?: string; i0: number; i1: number; punct?: string };
  const toks: Tok[] = [];
  while ((m = re.exec(text))) {
    if (m[1]) for (const w of numberWords(Math.min(+m[1], 999999)).split(' ')) toks.push({ word: w, i0: m.index, i1: m.index + m[0].length });
    else if (m[2]) for (const w of m[2].split('-').filter(Boolean)) toks.push({ word: w, i0: m.index, i1: m.index + m[0].length });
    else toks.push({ punct: m[3], i0: m.index, i1: m.index + m[0].length });
  }
  // phrases: runs of words between the pauses (for the pitch's fall and the last syllable's lengthening)
  let phraseStart = phones.length;
  const closePhrase = (end: TimedPhone['end']) => {
    const n = phones.length - phraseStart;
    if (n <= 0) return;
    const T0 = phones[phraseStart].t0, T1 = phones[phones.length - 1].t1;
    for (let i = phraseStart; i < phones.length; i++) { phones[i].phrase = (phones[i].t0 - T0) / Math.max(T1 - T0, 1e-3); phones[i].end = end; }
    phraseStart = phones.length;
  };
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    if (tk.punct) {
      const p = tk.punct;
      const end: TimedPhone['end'] = /\?/.test(p) ? '?' : /!/.test(p) ? '!' : /[.…]/.test(p) ? '.' : ',';
      // (the phrase's last syllable drawn out)
      const lastV = (() => { for (let i = phones.length - 1; i >= phraseStart; i--) if (VOWELS.has(phones[i].p)) return i; return -1; })();
      if (lastV >= 0) {
        const extra = (phones[lastV].t1 - phones[lastV].t0) * (end === ',' ? 0.3 : 0.5);
        phones[lastV].t1 += extra;
        for (let i = lastV + 1; i < phones.length; i++) { phones[i].t0 += extra; phones[i].t1 += extra; }
        t += extra;
        const wd = words[words.length - 1];
        if (wd) wd.t1 = phones[phones.length - 1]?.t1 ?? wd.t1;
      }
      closePhrase(end);
      const pause = (/…|\.\.\./.test(p) ? 0.55 : end === ',' ? 0.2 : /[;:—–-]/.test(p) ? 0.26 : 0.42) / Math.sqrt(rate);
      if (k < toks.length - 1) { phones.push({ p: '_', t0: t, t1: t + pause, stress: 0, word: -1, phrase: 0, end: '' }); t += pause; phraseStart = phones.length; }
      continue;
    }
    const wp = wordPhones(tk.word!);
    if (!wp.length) continue;
    const wi = words.length;
    const w0 = t;
    for (const { p, stress } of wp) {
      let d = DUR[p] / rate;
      if (VOWELS.has(p)) d *= stress === 2 ? 1.25 : LIGHT.has(tk.word!.toUpperCase()) ? 0.7 : 0.85;
      phones.push({ p, t0: t, t1: t + d, stress, word: wi, phrase: 0, end: '' });
      t += d;
    }
    words.push({ text: text.slice(tk.i0, tk.i1), t0: w0, t1: t, i0: tk.i0, i1: tk.i1 });
  }
  closePhrase('.');
  return { text, phones, words, dur: t + 0.08, question: /\?\s*$/.test(text), exclaim: /!\s*$/.test(text) };
}

// ---------------------------------------------------------------- visemes and the mouth
/** the mouth's shape (each 0..1): the jaw open, the lips spread (ee) or rounded (oo), pressed (m b p), the upper teeth
 *  showing, the tongue's tip up (l th n), the lower lip tucked under the teeth (f v) */
export interface Mouth { open: number; spread: number; round: number; press: number; teeth: number; tongue: number; tuck: number }
export type Viseme = 'sil' | 'PP' | 'FF' | 'TH' | 'DD' | 'kk' | 'CH' | 'SS' | 'nn' | 'RR' | 'aa' | 'E' | 'ih' | 'oh' | 'ou';
const V = (open: number, spread: number, round: number, press: number, teeth: number, tongue: number, tuck: number): Mouth => ({ open, spread, round, press, teeth, tongue, tuck });
export const VISEMES: Record<Viseme, Mouth> = {
  sil: V(0, 0, 0, 0, 0, 0, 0), PP: V(0, 0, 0.1, 1, 0, 0, 0), FF: V(0.12, 0.2, 0, 0, 0.9, 0, 1), TH: V(0.2, 0.15, 0, 0, 0.6, 1, 0),
  DD: V(0.24, 0.25, 0, 0, 0.6, 0.55, 0), kk: V(0.32, 0.15, 0, 0, 0.45, 0.15, 0), CH: V(0.2, 0, 0.55, 0, 0.9, 0, 0),
  SS: V(0.12, 0.55, 0, 0, 1, 0, 0), nn: V(0.22, 0.2, 0, 0, 0.5, 0.6, 0), RR: V(0.24, 0, 0.55, 0, 0.3, 0.1, 0),
  aa: V(0.88, 0.12, 0, 0, 0.35, 0.25, 0), E: V(0.52, 0.55, 0, 0, 0.6, 0.1, 0), ih: V(0.3, 0.8, 0, 0, 0.8, 0, 0),
  oh: V(0.62, 0, 0.75, 0, 0.15, 0.1, 0), ou: V(0.3, 0, 1, 0, 0, 0, 0),
};
/** each viseme's dominance (how hard it pulls the mouth to its shape against its neighbours) */
const DOM: Record<Viseme, number> = { sil: 0.6, PP: 4, FF: 2.4, TH: 1.0, DD: 0.45, kk: 0.35, CH: 1.6, SS: 1.3, nn: 0.5, RR: 0.9, aa: 1.1, E: 1, ih: 1, oh: 1.3, ou: 1.6 };
/** a phoneme's viseme (diphthongs: the first half's, then the second's) */
export function visemeOf(p: Phone, second = false): Viseme {
  switch (p) {
    case 'P': case 'B': case 'M': return 'PP';
    case 'F': case 'V': return 'FF';
    case 'TH': case 'DH': return 'TH';
    case 'T': case 'D': return 'DD';
    case 'K': case 'G': case 'NG': case 'HH': return 'kk';
    case 'CH': case 'JH': case 'SH': case 'ZH': return 'CH';
    case 'S': case 'Z': return 'SS';
    case 'N': case 'L': return 'nn';
    case 'R': case 'ER': return 'RR';
    case 'AA': case 'AH': case 'AX': return 'aa';
    case 'AE': case 'EH': return 'E';
    case 'IH': case 'IY': case 'Y': return 'ih';
    case 'AO': return 'oh';
    case 'UH': case 'UW': case 'W': return 'ou';
    case 'EY': return second ? 'ih' : 'E';
    case 'AY': return second ? 'ih' : 'aa';
    case 'AW': return second ? 'ou' : 'aa';
    case 'OW': return second ? 'ou' : 'oh';
    case 'OY': return second ? 'ih' : 'oh';
    default: return 'sil';
  }
}
interface Seg { c: number; h: number; v: Viseme; a: number; stress: number }
const segCache = new WeakMap<Timeline, Seg[]>();
/** the line's viseme segments (diphthongs split in two), with the silences round it */
function segments(tl: Timeline): Seg[] {
  let S = segCache.get(tl);
  if (S) return S;
  S = [{ c: -0.15, h: 0.15, v: 'sil', a: 1.5, stress: 0 }];
  for (const ph of tl.phones) {
    const d = ph.t1 - ph.t0;
    if (ph.p === '_') { S.push({ c: (ph.t0 + ph.t1) / 2, h: d / 2, v: 'sil', a: d > 0.3 ? 1.6 : 0.8, stress: 0 }); continue; }
    const two = ph.p === 'EY' || ph.p === 'AY' || ph.p === 'AW' || ph.p === 'OW' || ph.p === 'OY';
    if (two) {
      S.push({ c: ph.t0 + d * 0.3, h: d * 0.3, v: visemeOf(ph.p), a: DOM[visemeOf(ph.p)], stress: ph.stress });
      S.push({ c: ph.t0 + d * 0.78, h: d * 0.22, v: visemeOf(ph.p, true), a: DOM[visemeOf(ph.p, true)] * 0.8, stress: 0 });
    } else {
      const v = visemeOf(ph.p);
      S.push({ c: (ph.t0 + ph.t1) / 2, h: d / 2, v, a: DOM[v] * (ph.stress === 2 ? 1.2 : 1), stress: ph.stress });
    }
  }
  S.push({ c: tl.dur + 0.1, h: 0.12, v: 'sil', a: 1.5, stress: 0 });
  segCache.set(tl, S);
  return S;
}
const KEYS = ['open', 'spread', 'round', 'press', 'teeth', 'tongue', 'tuck'] as const;
/** the mouth at time t on the line, and how much the syllable then is stressed (0..1: the brows lift with it) */
export function mouthAt(tl: Timeline, t: number, out: Mouth = V(0, 0, 0, 0, 0, 0, 0)): { mouth: Mouth; emph: number } {
  const S = segments(tl);
  let sw = 0, emph = 0;
  for (const k of KEYS) out[k] = 0;
  for (const s of S) {
    const dt = Math.abs(t - s.c);
    if (dt > 0.45) continue;
    // (flat over the segment's middle, then falling away over about its own length again)
    const x = Math.max(0, dt - s.h * 0.35) / Math.max(s.h * 1.15 + 0.025, 0.04);
    const w = s.a * Math.exp(-x * x * 1.6);
    sw += w;
    const T = VISEMES[s.v];
    for (const k of KEYS) out[k] += T[k] * w;
    if (s.stress === 2) { const z = (t - s.c) / Math.max(s.h, 0.05); emph = Math.max(emph, Math.exp(-z * z)); }
  }
  if (sw > 1e-6) for (const k of KEYS) out[k] /= sw;
  // (a closure must close: the lips meet on p b m whatever the vowels round them)
  if (out.press > 0.5) out.open *= 1 - (out.press - 0.5) * 2;
  // (stressed vowels open a little wider)
  out.open = Math.min(1, out.open * (1 + 0.18 * emph));
  // (a recording: the jaw with its loudness, quiet syllables barely parted, loud ones wide; a laugh or a breath between
  // the words opens the mouth too)
  const e = tl.env;
  if (e) {
    const x = Math.max(0, t * e.rate), i = Math.floor(x), f = x - i, n = e.v.length;
    const k = i + 1 < n ? (e.v[i] * (1 - f) + e.v[i + 1] * f) / 255 : i < n ? e.v[i] / 255 : 0;
    out.open = Math.min(1, out.open * Math.min(1.2, 0.3 + 0.95 * k));
    if (out.press < 0.5) out.open = Math.max(out.open, Math.max(0, k - 0.5) * 1.3);
  }
  return { mouth: out, emph };
}

/** the word being said at time t (-1 before the first, the last after it) */
export function wordAt(tl: Timeline, t: number): number {
  let w = -1;
  for (let i = 0; i < tl.words.length; i++) if (tl.words[i].t0 <= t + 0.02) w = i;
  return w;
}

/** which phrase of the line time t is in (the pauses before it), -1 before the first word */
export function phraseAt(tl: Timeline, t: number): number {
  if (!tl.phones.length || t < tl.phones[0].t0) return -1;
  let n = 0;
  for (const p of tl.phones) { if (p.t0 > t) break; if (p.p === '_') n++; }
  return n;
}
