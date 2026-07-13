'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { FACTORY_NAME } from '@/lib/branding';

/**
 * قوالب طباعة جاهزة لوثائق الموظف:
 * - WARNING     : تنبيه خطي
 * - CONTRACT    : عقد عمل غير محدد المدة
 * - DECLARATION : إقرار
 * - RESIGNATION : تقديم استقالة
 */
const TEMPLATES: Record<string, { title: string; body: (emp: any) => JSX.Element }> = {
  WARNING: {
    title: 'تنبيه خطي',
    body: (emp) => (
      <>
        <p style={paragraph}>
          إلى الموظف: <b>{emp.fullName}</b>
          {emp.position ? ` — ${emp.position}` : ''}
          {emp.department ? ` (${emp.department})` : ''}
        </p>
        <p style={paragraph}>
          نُنبِّهكم خطياً بشأن المخالفة التالية:
        </p>
        <div style={{ ...box, minHeight: 90 }}>
          <div style={{ fontSize: 11, color: '#71717a' }}>وصف المخالفة:</div>
        </div>
        <p style={paragraph}>
          وعليه نرجو الالتزام بأنظمة وقواعد العمل المتّبعة داخل المصنع، علماً بأن أي تكرار
          لهذه المخالفة سيعرّضكم لعقوبات وفقاً لسياسة المصنع وقانون العمل الأردني.
        </p>
        <p style={{ ...paragraph, marginTop: 20 }}>
          هذا التنبيه أُصدر بتاريخ: <b>{fmtToday()}</b>
        </p>
      </>
    ),
  },
  CONTRACT: {
    title: 'عقد عمل غير محدد المدة',
    body: (emp) => (
      <>
        <p style={paragraph}>
          حُرِّر هذا العقد في مصنع <b>{FACTORY_NAME}</b> بتاريخ <b>{fmtToday()}</b> بين كل من:
        </p>
        <p style={paragraph}>
          <b>الفريق الأول (صاحب العمل):</b> {FACTORY_NAME}.
        </p>
        <p style={paragraph}>
          <b>الفريق الثاني (الموظف):</b> {emp.fullName}
          {emp.nationalId ? ` — رقم الهوية: ${emp.nationalId}` : ''}
        </p>
        <p style={paragraph}>
          اتفق الطرفان على النقاط التالية:
        </p>
        <ol style={{ paddingRight: 20, lineHeight: 1.9, fontSize: 12 }}>
          <li>يعمل الفريق الثاني لدى الفريق الأول بوظيفة <b>{emp.position || '.....'}</b>.</li>
          <li>يتقاضى الفريق الثاني راتباً أساسياً قدره <b>{emp.baseSalary ? Number(emp.baseSalary).toFixed(2) : '.....'}</b> دينار أردني شهرياً.</li>
          <li>يعمل الفريق الثاني وفق أنظمة الدوام المعتمدة في المصنع (26 يوم عمل شهرياً، 8 ساعات يومياً).</li>
          <li>يلتزم الفريق الثاني بأنظمة السلامة والنظافة والقواعد المهنية داخل المصنع.</li>
          <li>هذا العقد <b>غير محدد المدة</b> ويبدأ من تاريخ توقيعه.</li>
          <li>يجوز لأي طرف إنهاؤه بإشعار كتابي مسبق مدته لا تقل عن شهر، وفق أحكام قانون العمل الأردني.</li>
        </ol>
        <p style={{ ...paragraph, marginTop: 20 }}>
          ووقّع الطرفان على هذا العقد إقراراً بمحتواه.
        </p>
      </>
    ),
  },
  DECLARATION: {
    title: 'إقرار',
    body: (emp) => (
      <>
        <p style={paragraph}>
          أنا الموقّع أدناه: <b>{emp.fullName}</b>
          {emp.nationalId ? ` — رقم الهوية: ${emp.nationalId}` : ''}
          {emp.position ? ` — الوظيفة: ${emp.position}` : ''}.
        </p>
        <p style={paragraph}>
          أُقرُّ وأتعهّد بما يلي:
        </p>
        <div style={{ ...box, minHeight: 130 }}>
          <div style={{ fontSize: 11, color: '#71717a' }}>نص الإقرار:</div>
        </div>
        <p style={{ ...paragraph, marginTop: 20 }}>
          وقد وقّعتُ على هذا الإقرار بكامل إرادتي بتاريخ: <b>{fmtToday()}</b>
        </p>
      </>
    ),
  },
  RESIGNATION: {
    title: 'تقديم استقالة',
    body: (emp) => (
      <>
        <p style={paragraph}>
          <b>حضرة الإدارة المحترمة في {FACTORY_NAME}</b>
        </p>
        <p style={paragraph}>
          تحية طيبة وبعد،
        </p>
        <p style={paragraph}>
          أنا الموقّع أدناه: <b>{emp.fullName}</b>
          {emp.position ? ` — أعمل بصفة ${emp.position}` : ''}
          {emp.department ? ` في قسم ${emp.department}` : ''}،
        </p>
        <p style={paragraph}>
          أتقدّم بطلب استقالتي من العمل لديكم اعتباراً من تاريخ: <b>{fmtToday()}</b>،
          وذلك للأسباب التالية:
        </p>
        <div style={{ ...box, minHeight: 90 }}>
          <div style={{ fontSize: 11, color: '#71717a' }}>سبب الاستقالة:</div>
        </div>
        <p style={{ ...paragraph, marginTop: 20 }}>
          شاكراً لكم حسن تعاونكم وتقديركم.
        </p>
      </>
    ),
  },
};

const paragraph: React.CSSProperties = { fontSize: 13, lineHeight: 1.9, margin: '10px 0' };
const box: React.CSSProperties = {
  border: '1px dashed #d4d4d8', borderRadius: 6, padding: 12,
  background: '#fafafa', margin: '10px 0',
};

function fmtToday() {
  return new Date().toLocaleDateString('ar-JO', { dateStyle: 'long' });
}

export default function EmployeeDocTemplatePage() {
  const params = useParams();
  const id = params.id as string;
  const type = params.type as string;

  const { data: emp, isLoading } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => api.get(`/employees/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  useEffect(() => {
    if (!emp) return;
    const t = setTimeout(() => window.print(), 500);
    return () => clearTimeout(t);
  }, [emp]);

  const tpl = TEMPLATES[type];
  if (!tpl) return <div style={{ padding: 40 }}>قالب غير معروف</div>;
  if (isLoading || !emp) return <div style={{ padding: 40, textAlign: 'center' }}>جاري التحميل...</div>;

  return (
    <div className="print-root">
      <style jsx global>{`
        @page { size: A4 portrait; margin: 20mm 15mm; }
        html, body { background: #f4f4f5; margin: 0; padding: 0; }
        .print-root {
          font-family: 'Cairo', system-ui, sans-serif; color: #18181b;
          direction: rtl; max-width: 210mm; margin: 0 auto; padding: 20mm 15mm;
          background: white; min-height: 100vh;
        }
        .print-toolbar {
          display: flex; gap: 8px; justify-content: flex-end;
          padding: 12px; background: #fafafa;
          border-bottom: 1px solid #e4e4e7;
          margin: -20mm -15mm 16px -15mm;
        }
        .print-toolbar button {
          font-family: inherit; padding: 8px 16px; border: 1px solid #d4d4d8;
          background: white; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 13px;
        }
        .print-toolbar button.primary { background: #18181b; color: white; border-color: #18181b; }
        h1 { font-size: 22px; font-weight: 900; margin: 0 0 4px; }
        .factory-header {
          text-align: center; padding-bottom: 12px; margin-bottom: 20px;
          border-bottom: 2px solid #18181b;
        }
        .factory-name { font-size: 18px; font-weight: 900; }
        .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e4e4e7; }
        .sig-box { text-align: center; }
        .sig-box .role { font-size: 11px; font-weight: 800; color: #71717a; margin-bottom: 36px; text-transform: uppercase; letter-spacing: .04em; }
        .sig-box .line { border-top: 1px solid #18181b; padding-top: 4px; font-size: 11px; color: #52525b; }
        @media print { .print-toolbar { display: none !important; } }
      `}</style>

      <div className="print-toolbar">
        <button onClick={() => window.history.back()}>← رجوع</button>
        <button className="primary" onClick={() => window.print()}>🖨️ طباعة</button>
      </div>

      <div className="factory-header">
        <div className="factory-name">{FACTORY_NAME}</div>
        <h1>{tpl.title}</h1>
      </div>

      {tpl.body(emp)}

      <div className="signatures">
        <div className="sig-box">
          <div className="role">الموظف</div>
          <div className="line">
            الاسم: {emp.fullName}<br />التوقيع: ....................
          </div>
        </div>
        <div className="sig-box">
          <div className="role">الإدارة</div>
          <div className="line">
            الاسم: ....................<br />التوقيع: ....................
          </div>
        </div>
      </div>
    </div>
  );
}
