import { useUiSettingsStore, type Language } from "@/lib/store/ui-settings-store";
import en from "@/locales/en.json";
import ru from "@/locales/ru.json";
import uk from "@/locales/uk.json";
import pl from "@/locales/pl.json";
import de from "@/locales/de.json";
import es from "@/locales/es.json";

export type TranslationKey = keyof typeof en;

export { en as translations_en };

const locales: Record<Language, Record<string, string>> = {
  English: en,
  Russian: ru,
  Ukrainian: uk,
  Polish: pl,
  German: de,
  Spanish: es,
};

export function useI18n() {
  const language = useUiSettingsStore((state) => state.language);
  const t = (key: TranslationKey): string => locales[language][key] ?? en[key];
  return { t, language };
}
