import { COLORS } from "./colors";

export const MOCK = {
  term: { name: "2024–2025 Güz Dönemi", status: "Active" },
  stats: [
    { label: "Toplam Ders", value: 142, sub: "+12 bu dönem", color: COLORS.accent },
    { label: "Kayıtlı Öğrenci", value: 3847, sub: "23 bölüm", color: COLORS.cyan },
    { label: "Hard Conflict", value: 6, sub: "çakışma", color: COLORS.red },
    { label: "Sınav Odası", value: 34, sub: "aktif", color: COLORS.green },
  ],
  navSections: [
    {
      label: "1 — VERİ GİRİŞİ",
      items: [
        { id: "/", label: "Genel Bakış" },
        { id: "/terms", label: "Dönem Yönetimi" },
        { id: "/courses", label: "Ders Bölümleri" },
        { id: "/rooms", label: "Sınav Odaları" },
        { id: "/students", label: "Öğrenci & Kayıt" },
      ],
    },
    {
      label: "2 — SINAV PLANI",
      items: [
        { id: "/periods", label: "Sınav Dönemleri" },
        { id: "/exams", label: "Sınav Tanımları" },
        { id: "/constraints", label: "Kısıtlar" },
      ],
    },
    {
      label: "3 — OPTİMİZASYON",
      items: [
        { id: "/optimizer", label: "Çalıştır" },
        { id: "/solutions", label: "Çözümler" },
      ],
    },
    {
      label: "4 — SONUÇ",
      items: [
        { id: "/schedule", label: "Takvim Görünümü" },
        { id: "/export", label: "Dışa Aktar" },
      ],
    },
  ],
  solutions: [
    { id: 1, name: "Güz 2025 Test 1", status: "COMPLETED", score: 94.2, conflicts: 2, time: "4m 12s", date: "12 Nis 2025" },
    { id: 2, name: "Güz 2025 Test 2", status: "COMPLETED", score: 87.5, conflicts: 5, time: "6m 34s", date: "11 Nis 2025" },
    { id: 3, name: "Deneme Çalışması", status: "FAILED", score: null, conflicts: null, time: "12s", date: "10 Nis 2025" },
    { id: 4, name: "Hazırlık Turu", status: "PROCESSING", score: null, conflicts: null, time: "—", date: "12 Nis 2025" },
  ],
  examPeriods: [
    { name: "Vize Sınavları", type: "MIDTERM", start: "14 Nis", end: "25 Nis", exams: 38, status: "Planning" },
    { name: "Final Sınavları", type: "FINAL", start: "2 Haz", end: "16 Haz", exams: 0, status: "Planning" },
    { name: "Bütünleme", type: "MAKEUP", start: "23 Haz", end: "30 Haz", exams: 0, status: "Planning" },
  ],
  schedule: [
    { day: "Pzt 14 Nis", slots: [
        { time: "08:30", course: "MAT101", room: "A101", students: 85, dept: "Matematik" },
        { time: "10:30", course: "FİZ201", room: "B203", students: 62, dept: "Fizik" },
        { time: "13:00", course: "BİL301", room: "Lab-A", students: 40, dept: "Bilgisayar" },
      ]
    },
    { day: "Sal 15 Nis", slots: [
        { time: "08:30", course: "KİM102", room: "A102", students: 74, dept: "Kimya" },
        { time: "10:30", course: "END401", room: "C301", students: 55, dept: "Endüstri" },
        { time: "13:00", course: "MAT202", room: "A201", students: 90, dept: "Matematik" },
        { time: "15:30", course: "BİL201", room: "Lab-B", students: 38, dept: "Bilgisayar" },
      ]
    },
    { day: "Çar 16 Nis", slots: [
        { time: "09:00", course: "EKO101", room: "Amfi-1", students: 140, dept: "Ekonomi" },
        { time: "11:00", course: "İNG201", room: "D101", students: 48, dept: "Yabancı Dil" },
      ]
    },
  ],
};
