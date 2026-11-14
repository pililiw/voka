// Hand-written evaluation sets.
//  FIX  = misspellings and spellings by sound that Space should turn into the target word.
//  KEEP = real tokens the dictionary may not know (names, places, products, jargon, chat slang):
//         Space must commit them as typed (a case-insensitive match counts as kept).
//  PHON = spellings by sound whose target must be the first candidate or the Tab suggestion.
export const FIX: Record<string, string> = {
  freind: 'friend', becuase: 'because', tommorow: 'tomorrow', goverment: 'government', wich: 'which',
  untill: 'until', beleive: 'believe', adress: 'address', begining: 'beginning', buisness: 'business',
  calender: 'calendar', collegue: 'colleague', comming: 'coming', diffrent: 'different', embarass: 'embarrass',
  excelent: 'excellent', existance: 'existence', familar: 'familiar', finaly: 'finally', foward: 'forward',
  happend: 'happened', immediatly: 'immediately', knowlege: 'knowledge', libary: 'library',
  neccessary: 'necessary', ocasion: 'occasion', posible: 'possible', realy: 'really', relevent: 'relevant',
  remeber: 'remember', succesful: 'successful', suprise: 'surprise', tomorow: 'tomorrow', truely: 'truly',
  wierd: 'weird', writting: 'writing', thier: 'their', langauge: 'language', mesage: 'message',
  pasword: 'password', sevice: 'service', respone: 'response', reqest: 'request', databse: 'database',
  fucntion: 'function', paramter: 'parameter', lenght: 'length', reuslt: 'result', retrun: 'return',
  probaly: 'probably', intresting: 'interesting', expensiv: 'expensive', beutiful: 'beautiful',
  restarant: 'restaurant', temprature: 'temperature', defnitely: 'definitely', experiance: 'experience',
  recomend: 'recommend', apointment: 'appointment', oportunity: 'opportunity', especialy: 'especially',
  usualy: 'usually', anser: 'answer', qestion: 'question', problm: 'problem', importent: 'important',
  infomation: 'information', mantain: 'maintain', perfomance: 'performance', acheive: 'achieve',
  sucess: 'success', shedule: 'schedule', recipt: 'receipt',
  // free phonetic spelling
  hangri: 'hungry', komfort: 'comfort', katastrofi: 'catastrophe', skeduel: 'schedule', igzajereit: 'exaggerate',
  nolej: 'knowledge', bizi: 'busy', bikoz: 'because', enuf: 'enough', tumoro: 'tomorrow',
  sinsirli: 'sincerely', rili: 'really', plis: 'please', sori: 'sorry', fone: 'phone', foto: 'photo',
  kwik: 'quick', skool: 'school', laf: 'laugh', frend: 'friend', peple: 'people', langwage: 'language',
  egzample: 'example', diskashon: 'discussion', vejtebl: 'vegetable',
  prablem: 'problem', nesesari: 'necessary', biutiful: 'beautiful',
  restorant: 'restaurant', apoloji: 'apology', konfirm: 'confirm', sajest: 'suggest', rikwest: 'request',
};

export const KEEP = `maria ahmed priya nguyen kim garcia ivanov tanaka chen olga fatima carlos yusuf kofi
tokyo beijing mumbai lagos cairo berlin madrid toronto sydney jakarta seoul hanoi lima nairobi istanbul
google youtube facebook instagram whatsapp netflix spotify amazon ikea toyota samsung nintendo wikipedia
gmail outlook zoom login logout wifi bluetooth homepage screenshot smartphone username website podcast
emoji selfie vlog blog app online email linux api cpu usb pdf html url sql http json
lol btw fyi imo idk tbh haha hmm yep omg ok
sushi ramen tofu kimchi latte mocha taco pizza pasta curry hummus kebab paella biryani
nov jan dec oct sep wed fri usd eur`.split(/\s+/).filter(Boolean);

export const PHON: Record<string, string> = {
  zmbie: 'zombie', komfort: 'comfort', hangri: 'hungry',
  katastrofi: 'catastrophe', igzajereit: 'exaggerate', skeduel: 'schedule',
};
