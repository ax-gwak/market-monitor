import fs from "fs";
import path from "path";

export interface Stock {
  code: string;
  name: string;
  market: "KOSPI" | "KOSDAQ";
  isLargeCap: boolean;
}

const CUSTOM_UNIVERSE_PATH = path.join(process.cwd(), "data", "stock-universe.json");

let cachedUniverse: Stock[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export function getStockUniverse(): Stock[] {
  const now = Date.now();
  if (cachedUniverse && now - cacheTimestamp < CACHE_TTL) {
    return cachedUniverse;
  }

  try {
    if (fs.existsSync(CUSTOM_UNIVERSE_PATH)) {
      const raw = fs.readFileSync(CUSTOM_UNIVERSE_PATH, "utf-8");
      const parsed: Stock[] = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].code && parsed[0].name) {
        console.log(`[StockUniverse] Loaded ${parsed.length} stocks from custom file`);
        cachedUniverse = parsed;
        cacheTimestamp = now;
        return parsed;
      }
    }
  } catch (err) {
    console.warn("[StockUniverse] Failed to load custom universe, using defaults:", err);
  }

  cachedUniverse = getDefaultUniverse();
  cacheTimestamp = now;
  return cachedUniverse;
}

export function reloadUniverse(): void {
  cachedUniverse = null;
  cacheTimestamp = 0;
}

function getDefaultUniverse(): Stock[] {
  return [
    // KOSPI 대형주 (top 40 by market cap)
    { code: "005930", name: "삼성전자", market: "KOSPI", isLargeCap: true },
    { code: "000660", name: "SK하이닉스", market: "KOSPI", isLargeCap: true },
    { code: "207940", name: "삼성바이오로직스", market: "KOSPI", isLargeCap: true },
    { code: "373220", name: "LG에너지솔루션", market: "KOSPI", isLargeCap: true },
    { code: "005380", name: "현대차", market: "KOSPI", isLargeCap: true },
    { code: "000270", name: "기아", market: "KOSPI", isLargeCap: true },
    { code: "105560", name: "KB금융", market: "KOSPI", isLargeCap: true },
    { code: "068270", name: "셀트리온", market: "KOSPI", isLargeCap: true },
    { code: "005490", name: "POSCO홀딩스", market: "KOSPI", isLargeCap: true },
    { code: "006400", name: "삼성SDI", market: "KOSPI", isLargeCap: true },
    { code: "012330", name: "현대모비스", market: "KOSPI", isLargeCap: true },
    { code: "051910", name: "LG화학", market: "KOSPI", isLargeCap: true },
    { code: "028260", name: "삼성물산", market: "KOSPI", isLargeCap: true },
    { code: "035420", name: "NAVER", market: "KOSPI", isLargeCap: true },
    { code: "035720", name: "카카오", market: "KOSPI", isLargeCap: true },
    { code: "055550", name: "신한지주", market: "KOSPI", isLargeCap: true },
    { code: "086790", name: "하나금융지주", market: "KOSPI", isLargeCap: true },
    { code: "033780", name: "KT&G", market: "KOSPI", isLargeCap: true },
    { code: "066570", name: "LG전자", market: "KOSPI", isLargeCap: true },
    { code: "009150", name: "삼성전기", market: "KOSPI", isLargeCap: true },
    { code: "003550", name: "LG", market: "KOSPI", isLargeCap: true },
    { code: "259960", name: "크래프톤", market: "KOSPI", isLargeCap: true },
    { code: "096770", name: "SK이노베이션", market: "KOSPI", isLargeCap: true },
    { code: "034730", name: "SK", market: "KOSPI", isLargeCap: true },
    { code: "003670", name: "포스코퓨처엠", market: "KOSPI", isLargeCap: true },
    { code: "032830", name: "삼성생명", market: "KOSPI", isLargeCap: true },
    { code: "010130", name: "고려아연", market: "KOSPI", isLargeCap: true },
    { code: "030200", name: "KT", market: "KOSPI", isLargeCap: true },
    { code: "034020", name: "두산에너빌리티", market: "KOSPI", isLargeCap: true },
    { code: "009540", name: "HD한국조선해양", market: "KOSPI", isLargeCap: true },
    { code: "138040", name: "메리츠금융지주", market: "KOSPI", isLargeCap: true },
    { code: "017670", name: "SK텔레콤", market: "KOSPI", isLargeCap: true },
    { code: "011200", name: "HMM", market: "KOSPI", isLargeCap: true },
    { code: "329180", name: "현대중공업", market: "KOSPI", isLargeCap: true },
    { code: "090430", name: "아모레퍼시픽", market: "KOSPI", isLargeCap: true },
    { code: "003490", name: "대한항공", market: "KOSPI", isLargeCap: true },
    { code: "010950", name: "S-Oil", market: "KOSPI", isLargeCap: true },
    { code: "018260", name: "삼성에스디에스", market: "KOSPI", isLargeCap: true },
    { code: "267250", name: "HD현대", market: "KOSPI", isLargeCap: true },
    { code: "036570", name: "엔씨소프트", market: "KOSPI", isLargeCap: true },

    // KOSPI 중소형주 (40 stocks)
    { code: "011780", name: "금호석유", market: "KOSPI", isLargeCap: false },
    { code: "006360", name: "GS건설", market: "KOSPI", isLargeCap: false },
    { code: "000810", name: "삼성화재", market: "KOSPI", isLargeCap: false },
    { code: "016360", name: "삼성증권", market: "KOSPI", isLargeCap: false },
    { code: "005830", name: "DB손해보험", market: "KOSPI", isLargeCap: false },
    { code: "088980", name: "맥쿼리인프라", market: "KOSPI", isLargeCap: false },
    { code: "009830", name: "한화솔루션", market: "KOSPI", isLargeCap: false },
    { code: "071050", name: "한국금융지주", market: "KOSPI", isLargeCap: false },
    { code: "032640", name: "LG유플러스", market: "KOSPI", isLargeCap: false },
    { code: "139480", name: "이마트", market: "KOSPI", isLargeCap: false },
    { code: "078930", name: "GS", market: "KOSPI", isLargeCap: false },
    { code: "001040", name: "CJ", market: "KOSPI", isLargeCap: false },
    { code: "069960", name: "현대백화점", market: "KOSPI", isLargeCap: false },
    { code: "018880", name: "한온시스템", market: "KOSPI", isLargeCap: false },
    { code: "047810", name: "한국항공우주", market: "KOSPI", isLargeCap: false },
    { code: "005940", name: "NH투자증권", market: "KOSPI", isLargeCap: false },
    { code: "020150", name: "일진머티리얼즈", market: "KOSPI", isLargeCap: false },
    { code: "375500", name: "DL이앤씨", market: "KOSPI", isLargeCap: false },
    { code: "005300", name: "롯데칠성", market: "KOSPI", isLargeCap: false },
    { code: "000150", name: "두산", market: "KOSPI", isLargeCap: false },
    { code: "015750", name: "성우하이텍", market: "KOSPI", isLargeCap: false },
    { code: "051600", name: "한전KPS", market: "KOSPI", isLargeCap: false },
    { code: "001120", name: "LX인터내셔널", market: "KOSPI", isLargeCap: false },
    { code: "021240", name: "코웨이", market: "KOSPI", isLargeCap: false },
    { code: "161390", name: "한국타이어앤테크놀로지", market: "KOSPI", isLargeCap: false },
    { code: "000880", name: "한화", market: "KOSPI", isLargeCap: false },
    { code: "030000", name: "제일기획", market: "KOSPI", isLargeCap: false },
    { code: "011170", name: "롯데케미칼", market: "KOSPI", isLargeCap: false },
    { code: "009240", name: "한샘", market: "KOSPI", isLargeCap: false },
    { code: "011790", name: "SKC", market: "KOSPI", isLargeCap: false },
    { code: "042670", name: "HD현대인프라코어", market: "KOSPI", isLargeCap: false },
    { code: "002380", name: "KCC", market: "KOSPI", isLargeCap: false },
    { code: "001740", name: "SK네트웍스", market: "KOSPI", isLargeCap: false },
    { code: "006800", name: "미래에셋증권", market: "KOSPI", isLargeCap: false },
    { code: "008930", name: "한미사이언스", market: "KOSPI", isLargeCap: false },
    { code: "272210", name: "한화시스템", market: "KOSPI", isLargeCap: false },
    { code: "009420", name: "한올바이오파마", market: "KOSPI", isLargeCap: false },
    { code: "004020", name: "현대제철", market: "KOSPI", isLargeCap: false },
    { code: "000120", name: "CJ대한통운", market: "KOSPI", isLargeCap: false },
    { code: "097950", name: "CJ제일제당", market: "KOSPI", isLargeCap: false },

    // KOSDAQ 대형주 (top 40 by market cap)
    { code: "247540", name: "에코프로비엠", market: "KOSDAQ", isLargeCap: true },
    { code: "086520", name: "에코프로", market: "KOSDAQ", isLargeCap: true },
    { code: "403870", name: "HPSP", market: "KOSDAQ", isLargeCap: true },
    { code: "196170", name: "알테오젠", market: "KOSDAQ", isLargeCap: true },
    { code: "041510", name: "에스엠", market: "KOSDAQ", isLargeCap: true },
    { code: "263750", name: "펄어비스", market: "KOSDAQ", isLargeCap: true },
    { code: "293490", name: "카카오게임즈", market: "KOSDAQ", isLargeCap: true },
    { code: "035900", name: "JYP Ent.", market: "KOSDAQ", isLargeCap: true },
    { code: "328130", name: "루닛", market: "KOSDAQ", isLargeCap: true },
    { code: "039030", name: "이오테크닉스", market: "KOSDAQ", isLargeCap: true },
    { code: "257720", name: "실리콘투", market: "KOSDAQ", isLargeCap: true },
    { code: "068760", name: "셀트리온제약", market: "KOSDAQ", isLargeCap: true },
    { code: "145020", name: "휴젤", market: "KOSDAQ", isLargeCap: true },
    { code: "112040", name: "위메이드", market: "KOSDAQ", isLargeCap: true },
    { code: "253450", name: "스튜디오드래곤", market: "KOSDAQ", isLargeCap: true },
    { code: "086900", name: "메디톡스", market: "KOSDAQ", isLargeCap: true },
    { code: "214150", name: "클래시스", market: "KOSDAQ", isLargeCap: true },
    { code: "215200", name: "메가스터디교육", market: "KOSDAQ", isLargeCap: true },
    { code: "067160", name: "아프리카TV", market: "KOSDAQ", isLargeCap: true },
    { code: "078340", name: "컴투스", market: "KOSDAQ", isLargeCap: true },
    { code: "278470", name: "에이피알", market: "KOSDAQ", isLargeCap: true },
    { code: "215600", name: "신라젠", market: "KOSDAQ", isLargeCap: true },
    { code: "376300", name: "디어유", market: "KOSDAQ", isLargeCap: true },
    { code: "060310", name: "3S", market: "KOSDAQ", isLargeCap: true },
    { code: "095340", name: "ISC", market: "KOSDAQ", isLargeCap: true },
    { code: "357780", name: "솔브레인", market: "KOSDAQ", isLargeCap: true },
    { code: "036930", name: "주성엔지니어링", market: "KOSDAQ", isLargeCap: true },
    { code: "272110", name: "케이엔제이", market: "KOSDAQ", isLargeCap: true },
    { code: "005290", name: "동진쎄미켐", market: "KOSDAQ", isLargeCap: true },
    { code: "348350", name: "위드리졸브AI", market: "KOSDAQ", isLargeCap: true },
    { code: "039200", name: "오스코텍", market: "KOSDAQ", isLargeCap: true },
    { code: "323990", name: "박셀바이오", market: "KOSDAQ", isLargeCap: true },
    { code: "140860", name: "파크시스템스", market: "KOSDAQ", isLargeCap: true },
    { code: "033640", name: "네패스", market: "KOSDAQ", isLargeCap: true },
    { code: "336370", name: "솔루스첨단소재", market: "KOSDAQ", isLargeCap: true },
    { code: "240810", name: "원익IPS", market: "KOSDAQ", isLargeCap: true },
    { code: "352820", name: "하이브", market: "KOSDAQ", isLargeCap: true },
    { code: "048410", name: "현대바이오사이언스", market: "KOSDAQ", isLargeCap: true },
    { code: "108860", name: "셀바스AI", market: "KOSDAQ", isLargeCap: true },
    { code: "226330", name: "신테카바이오", market: "KOSDAQ", isLargeCap: true },

    // KOSDAQ 중소형주 (40 stocks)
    { code: "095660", name: "네오위즈", market: "KOSDAQ", isLargeCap: false },
    { code: "086450", name: "동국제약", market: "KOSDAQ", isLargeCap: false },
    { code: "039610", name: "화성밸브", market: "KOSDAQ", isLargeCap: false },
    { code: "018290", name: "브이티", market: "KOSDAQ", isLargeCap: false },
    { code: "091120", name: "이엠텍", market: "KOSDAQ", isLargeCap: false },
    { code: "110990", name: "디아이티", market: "KOSDAQ", isLargeCap: false },
    { code: "083930", name: "아바코", market: "KOSDAQ", isLargeCap: false },
    { code: "141080", name: "레고켐바이오", market: "KOSDAQ", isLargeCap: false },
    { code: "102120", name: "어보브반도체", market: "KOSDAQ", isLargeCap: false },
    { code: "073240", name: "금호타이어", market: "KOSDAQ", isLargeCap: false },
    { code: "054950", name: "제이비", market: "KOSDAQ", isLargeCap: false },
    { code: "268280", name: "에이치피오", market: "KOSDAQ", isLargeCap: false },
    { code: "036810", name: "에프에스티", market: "KOSDAQ", isLargeCap: false },
    { code: "170900", name: "동아에스티", market: "KOSDAQ", isLargeCap: false },
    { code: "290670", name: "대보마그네틱", market: "KOSDAQ", isLargeCap: false },
    { code: "383310", name: "에코프로에이치엔", market: "KOSDAQ", isLargeCap: false },
    { code: "144510", name: "지씨셀", market: "KOSDAQ", isLargeCap: false },
    { code: "196300", name: "애니플러스", market: "KOSDAQ", isLargeCap: false },
    { code: "388720", name: "유일로보틱스", market: "KOSDAQ", isLargeCap: false },
    { code: "246690", name: "에스앤더블류", market: "KOSDAQ", isLargeCap: false },
    { code: "319400", name: "현대무벡스", market: "KOSDAQ", isLargeCap: false },
    { code: "064800", name: "젠큐릭스", market: "KOSDAQ", isLargeCap: false },
    { code: "138230", name: "지엔코", market: "KOSDAQ", isLargeCap: false },
    { code: "065350", name: "신성델타테크", market: "KOSDAQ", isLargeCap: false },
    { code: "051510", name: "알에프텍", market: "KOSDAQ", isLargeCap: false },
    { code: "064090", name: "웨이버스", market: "KOSDAQ", isLargeCap: false },
    { code: "078130", name: "마이크로컨텍솔", market: "KOSDAQ", isLargeCap: false },
    { code: "069410", name: "엔텔스", market: "KOSDAQ", isLargeCap: false },
    { code: "067310", name: "하나마이크론", market: "KOSDAQ", isLargeCap: false },
    { code: "131970", name: "테스나", market: "KOSDAQ", isLargeCap: false },
    { code: "200710", name: "에이디테크놀로지", market: "KOSDAQ", isLargeCap: false },
    { code: "043150", name: "바이오니아", market: "KOSDAQ", isLargeCap: false },
    { code: "222800", name: "심텍", market: "KOSDAQ", isLargeCap: false },
    { code: "058470", name: "리노공업", market: "KOSDAQ", isLargeCap: false },
    { code: "033100", name: "제룡전기", market: "KOSDAQ", isLargeCap: false },
    { code: "317770", name: "엑세스바이오", market: "KOSDAQ", isLargeCap: false },
    { code: "089030", name: "테크윙", market: "KOSDAQ", isLargeCap: false },
    { code: "950160", name: "코오롱티슈진", market: "KOSDAQ", isLargeCap: false },
    { code: "039440", name: "에스티아이", market: "KOSDAQ", isLargeCap: false },
    { code: "228760", name: "지노믹트리", market: "KOSDAQ", isLargeCap: false },
  ];
}
