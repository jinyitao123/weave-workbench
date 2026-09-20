const recoveryPage = `
function App(){
  const entries=['待对账池','供应商聚合','委外订单','回厂批次','加工费','补料','扣款','应付','关联应付','对账状态'];
  const colors={bg:'hsl(var(--background))',card:'hsl(var(--card))',border:'hsl(var(--border))',text:'hsl(var(--foreground))',muted:'hsl(var(--muted-foreground))'};
  return <main style={{minHeight:'100%',background:colors.bg,color:colors.text,padding:'24px'}}>
    <div style={{maxWidth:'1040px',margin:'0 auto'}}>
      <div style={{fontSize:'12px',color:colors.muted,marginBottom:'8px'}}>生产 / 委外管理</div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'16px',marginBottom:'20px'}}>
        <div><h1 style={{fontSize:'24px',fontWeight:650,margin:'0 0 6px'}}>委外对账</h1><div style={{fontSize:'13px',color:colors.muted}}>这里集中展示委外对账的业务入口和办理范围。</div></div>
        <span style={{border:'1px solid '+colors.border,borderRadius:'4px',padding:'6px 10px',fontSize:'12px',color:colors.muted}}>入口目录</span>
      </div>
      <section style={{background:colors.card,border:'1px solid '+colors.border,borderRadius:'6px',padding:'18px'}}>
        <h2 style={{fontSize:'15px',margin:'0 0 14px'}}>业务入口</h2>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:'8px'}}>{entries.map(entry=><div key={entry} style={{border:'1px solid '+colors.border,borderRadius:'4px',padding:'10px 12px',fontSize:'13px'}}>{entry}</div>)}</div>
      </section>
    </div>
  </main>;
}
`;

export const SubcontractReconciliationRecoveryStatusPage = {
  name: 'page_subcontract_reconciliation_recovery_status',
  label: '委外对账',
  description: '集中查看委外待对账池和委外对账单',
  icon: 'file-check-2',
  type: 'app' as const,
  kind: 'react' as const,
  source: recoveryPage,
};
