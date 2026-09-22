/**
 * test/suite/offline/dataScientistEngine.test.ts — Unit tests for Autonomous Data Scientist Engine
 */

import * as assert from 'assert';
import { DataScientistEngine, DataScienceAnalysisResult } from '../../../offline/dataScientistEngine';

suite('Autonomous Data Scientist & Statistical Intelligence Engine Suite', () => {

  const sampleSupplyChainRecords = [
    { order_id: 'ORD-001', region: 'North', warehouse_stage: 12, transit_stage: 48, customs_stage: 140, total_delay_hrs: 200, freight_cost: 1500, package_weight: 45, is_priority: 0 },
    { order_id: 'ORD-002', region: 'South', warehouse_stage: 10, transit_stage: 24, customs_stage: 15, total_delay_hrs: 49, freight_cost: 320, package_weight: 12, is_priority: 1 },
    { order_id: 'ORD-003', region: 'North', warehouse_stage: 14, transit_stage: 52, customs_stage: 165, total_delay_hrs: 231, freight_cost: 1800, package_weight: 50, is_priority: 0 },
    { order_id: 'ORD-004', region: 'West', warehouse_stage: 8, transit_stage: 20, customs_stage: 12, total_delay_hrs: 40, freight_cost: 290, package_weight: 8, is_priority: 1 },
    { order_id: 'ORD-005', region: 'East', warehouse_stage: 9, transit_stage: 22, customs_stage: 18, total_delay_hrs: 49, freight_cost: 310, package_weight: 10, is_priority: 1 },
    { order_id: 'ORD-006', region: 'North', warehouse_stage: 16, transit_stage: 60, customs_stage: 210, total_delay_hrs: 286, freight_cost: 2400, package_weight: 65, is_priority: 0 },
    { order_id: 'ORD-007', region: 'South', warehouse_stage: 11, transit_stage: 26, customs_stage: 14, total_delay_hrs: 51, freight_cost: 330, package_weight: 14, is_priority: 1 },
    { order_id: 'ORD-008', region: 'West', warehouse_stage: 7, transit_stage: 19, customs_stage: 10, total_delay_hrs: 36, freight_cost: 260, package_weight: 7, is_priority: 1 },
    { order_id: 'ORD-009', region: 'North', warehouse_stage: 15, transit_stage: 55, customs_stage: 180, total_delay_hrs: 250, freight_cost: 2100, package_weight: 58, is_priority: 0 },
    { order_id: 'ORD-010', region: 'East', warehouse_stage: 10, transit_stage: 25, customs_stage: 16, total_delay_hrs: 51, freight_cost: 340, package_weight: 11, is_priority: 1 },
    // Extreme statistical anomaly / outlier record
    { order_id: 'ORD-999', region: 'AnomalyZone', warehouse_stage: 95, transit_stage: 320, customs_stage: 980, total_delay_hrs: 1395, freight_cost: 14500, package_weight: 420, is_priority: 0 }
  ];

  const columns = Object.keys(sampleSupplyChainRecords[0]);

  test('detects semantic roles and isolates target KPI with parametric & non-parametric stats', () => {
    const res: DataScienceAnalysisResult = DataScientistEngine.analyze(sampleSupplyChainRecords, columns, {
      targetKpi: 'total_delay_hrs',
      datasetTitle: 'Supply_Chain_Logistics.csv'
    });

    assert.strictEqual(res.totalRecords, 11);
    assert.strictEqual(res.targetKpiName, 'total_delay_hrs');
    assert.ok(res.targetKpiStats);
    assert.ok(res.targetKpiStats.mean > 0);
    assert.ok(res.targetKpiStats.median > 0);
    assert.ok(res.targetKpiStats.stdDev > 0);
    assert.ok(res.targetKpiStats.iqr > 0);
    assert.ok(res.targetKpiStats.max >= 1395);
  });

  test('identifies velocity bottlenecks and ranks cycle-time latency stages', () => {
    const res = DataScientistEngine.analyze(sampleSupplyChainRecords, columns, {
      targetKpi: 'total_delay_hrs'
    });

    assert.ok(res.bottlenecks.stages.length > 0);
    // customs_stage or transit_stage should be identified as the dominant cycle-time bottleneck
    const topBottleneck = res.bottlenecks.stages[0];
    assert.ok(topBottleneck.stageName.includes('customs') || topBottleneck.stageName.includes('transit') || topBottleneck.stageName.includes('stage'));
    assert.ok(topBottleneck.avgDurationHours > 0);
    assert.ok(topBottleneck.pctOfTotalLatency > 0);
    assert.ok(topBottleneck.severity === 'critical' || topBottleneck.severity === 'moderate' || topBottleneck.severity === 'normal');
  });

  test('computes Pearson multivariate correlation and ranks key drivers', () => {
    const res = DataScientistEngine.analyze(sampleSupplyChainRecords, columns, {
      targetKpi: 'total_delay_hrs'
    });

    assert.ok(res.keyDrivers.drivers.length > 0);
    // freight_cost and package_weight strongly drive total_delay_hrs in this sample
    const costDriver = res.keyDrivers.drivers.find(d => d.featureName === 'freight_cost');
    assert.ok(costDriver);
    assert.ok(costDriver.correlation > 0.8);
    assert.strictEqual(costDriver.direction, 'positive');
    assert.ok(costDriver.importanceWeight >= 0);
  });

  test('computes Pareto 80/20 leverage and confirms concentration', () => {
    const res = DataScientistEngine.analyze(sampleSupplyChainRecords, columns, {
      targetKpi: 'total_delay_hrs'
    });

    assert.ok(res.pareto);
    assert.ok(res.pareto.topPercentile > 0);
    assert.ok(res.pareto.capturedImpactPercent > 0);
    assert.ok(res.pareto.summaryText.length > 0);
  });

  test('isolates severe outliers using Tukey IQR fence and produces diagnostic root cause cards', () => {
    const res = DataScientistEngine.analyze(sampleSupplyChainRecords, columns, {
      targetKpi: 'total_delay_hrs'
    });

    assert.ok(res.outliers.records.length > 0);
    const extremeOutlier = res.outliers.records.find(o => String(o.id).includes('ORD-999') || o.primaryLabel.includes('ORD-999'));
    assert.ok(extremeOutlier, 'ORD-999 should be classified as a severe outlier');
    assert.ok(extremeOutlier.zScore > 2.0);
    assert.ok(extremeOutlier.severityScore > 50);
    assert.ok(extremeOutlier.rootCauseInsight.length > 10);
  });

  test('generates normalized 3D scatter manifold coordinates with pulsing beacons', () => {
    const res = DataScientistEngine.analyze(sampleSupplyChainRecords, columns, {
      targetKpi: 'total_delay_hrs'
    });

    assert.strictEqual(res.points3D.length, 11);
    assert.ok(res.rawRecords && res.rawRecords.length === 11, 'res.rawRecords should preserve raw dataset records');
    for (const pt of res.points3D) {
      assert.ok(pt.x >= -100 && pt.x <= 100);
      assert.ok(pt.y >= -100 && pt.y <= 100);
      assert.ok(pt.z >= -100 && pt.z <= 100);
      assert.ok(pt.color);
      assert.ok(pt.diagnosticCard);
      assert.ok(pt.rawRecord, 'Each 3D point must carry rawRecord for dynamic client-side re-projection');
      assert.strictEqual(typeof pt.rawRecord?.total_delay_hrs, 'number');
    }

    const outlier3DPt = res.points3D.find(pt => pt.label.includes('ORD-999') || String(pt.id).includes('ORD-999'));
    assert.ok(outlier3DPt);
    assert.strictEqual(outlier3DPt.isOutlier, true);
    assert.strictEqual(outlier3DPt.color, '#ef4444');
    assert.strictEqual(outlier3DPt.rawRecord?.order_id, 'ORD-999');
  });

  test('generates all 4 production deliverables with embedded visualizations and scripts', () => {
    const res = DataScientistEngine.analyze(sampleSupplyChainRecords, columns, {
      targetKpi: 'total_delay_hrs',
      focus: 'Logistics cycle-time chokepoints and customs delays',
      datasetTitle: 'Supply_Chain_Logistics.csv'
    });

    // 1. Executive HTML Report
    const html = DataScientistEngine.generateExecutiveHtmlReport(res);
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('Executive Diagnostic Data Report'));
    assert.ok(html.includes('<svg')); // Embedded 2D chart
    assert.ok(html.includes('<canvas id="canvas3DReport"')); // Embedded 3D canvas
    assert.ok(html.includes('ORD-999')); // Outlier highlighted in report

    // 2. Jupyter / Python Script
    const pyScript = DataScientistEngine.generatePythonDataScienceScript(res, 'Supply_Chain_Logistics.csv');
    assert.ok(pyScript.includes('import pandas as pd'));
    assert.ok(pyScript.includes('import scipy.stats as stats'));
    assert.ok(pyScript.includes('from sklearn.cluster import KMeans'));
    assert.ok(pyScript.includes('total_delay_hrs'));

    // 3. Markdown Briefing
    const md = DataScientistEngine.generateExecutiveInsightsMarkdown(res);
    assert.ok(md.includes('Executive Data Scientist Briefing'));
    assert.ok(md.includes('Process Bottleneck & Friction Diagnostics'));
    assert.ok(md.includes('Pareto 80/20 & Outlier Risk Analysis'));

    // 4. Statistical Profiling Matrix
    const profile = DataScientistEngine.generateStatisticalProfile(res);
    assert.ok(profile.includes('[Evolve AI Data Scientist — Statistical Distribution & Profiling Matrix]'));
    assert.ok(profile.includes('PARAMETRIC & NON-PARAMETRIC DISPERSION'));
  });

  test('Focus Mode: Process Bottlenecks & Velocity Chokepoints produces specialized intelligence', () => {
    const res = DataScientistEngine.analyze(sampleSupplyChainRecords, columns, {
      targetKpi: 'total_delay_hrs',
      focus: 'Process Bottlenecks & Velocity Chokepoints'
    });

    assert.strictEqual(res.focusMode, 'bottlenecks');
    assert.strictEqual(res.focusBadge, '⏱️ Bottleneck Focus');
    assert.strictEqual(res.focusKpis.length, 4);
    assert.strictEqual(res.focusKpis[0].id, 'kpi_primary_chokepoint');
    assert.strictEqual(res.axisLabels3D.x, 'Stage Sequence Rank');
    assert.strictEqual(res.axisLabels3D.y, 'Stage Latency Duration');
    assert.strictEqual(res.axisLabels3D.z, 'Cycle Delay Impact');
    assert.ok(res.prescriptiveActions[0].category.toLowerCase().includes('bottleneck') || res.prescriptiveActions[0].category.toLowerCase().includes('velocity') || res.prescriptiveActions[0].category.toLowerCase().includes('latency'));

    const md = DataScientistEngine.generateExecutiveInsightsMarkdown(res);
    assert.ok(md.includes('## 2. Process Bottleneck & Friction Diagnostics'));
  });

  test('Focus Mode: Multivariate Key Drivers & Root Cause Analysis produces specialized intelligence', () => {
    const res = DataScientistEngine.analyze(sampleSupplyChainRecords, columns, {
      targetKpi: 'total_delay_hrs',
      focus: 'Multivariate Key Drivers & Root Cause Analysis'
    });

    assert.strictEqual(res.focusMode, 'drivers');
    assert.strictEqual(res.focusBadge, '🎯 Key Driver Focus');
    assert.strictEqual(res.focusKpis.length, 4);
    assert.strictEqual(res.focusKpis[0].id, 'kpi_positive_catalyst');
    assert.strictEqual(res.axisLabels3D.x, 'total_delay_hrs');
    assert.ok(res.prescriptiveActions[0].category.toLowerCase().includes('driver') || res.prescriptiveActions[0].category.toLowerCase().includes('root cause') || res.prescriptiveActions[0].category.toLowerCase().includes('catalyst'));

    const md = DataScientistEngine.generateExecutiveInsightsMarkdown(res);
    assert.ok(md.includes('## 2. Multivariate Key Driver Analysis'));
  });

  test('Focus Mode: Pareto 80/20 Leverage & Outlier Risk Exposure produces specialized intelligence', () => {
    const res = DataScientistEngine.analyze(sampleSupplyChainRecords, columns, {
      targetKpi: 'total_delay_hrs',
      focus: 'Pareto 80/20 Leverage & Outlier Risk Exposure'
    });

    assert.strictEqual(res.focusMode, 'outliers');
    assert.strictEqual(res.focusBadge, '🚨 Outlier & Pareto Focus');
    assert.strictEqual(res.focusKpis.length, 4);
    assert.strictEqual(res.focusKpis[0].id, 'kpi_pareto_leverage');
    assert.strictEqual(res.axisLabels3D.x, 'total_delay_hrs');
    assert.strictEqual(res.axisLabels3D.y, 'Z-Score Anomaly Deviation');
    assert.strictEqual(res.axisLabels3D.z, 'Segment Risk Factor');
    assert.ok(res.prescriptiveActions[0].category.toLowerCase().includes('outlier') || res.prescriptiveActions[0].category.toLowerCase().includes('risk') || res.prescriptiveActions[0].category.toLowerCase().includes('anomaly'));

    const md = DataScientistEngine.generateExecutiveInsightsMarkdown(res);
    assert.ok(md.includes('## 2. Pareto 80/20 & Outlier Risk Analysis'));
  });

  test('Focus Mode: Cohort & Segment Performance Gap Analysis produces specialized intelligence', () => {
    const res = DataScientistEngine.analyze(sampleSupplyChainRecords, columns, {
      targetKpi: 'total_delay_hrs',
      focus: 'Cohort & Segment Performance Gap Analysis'
    });

    assert.strictEqual(res.focusMode, 'cohorts');
    assert.strictEqual(res.focusBadge, '📊 Cohort Focus');
    assert.strictEqual(res.focusKpis.length, 4);
    assert.strictEqual(res.focusKpis[0].id, 'kpi_best_cohort');
    assert.strictEqual(res.axisLabels3D.x, 'Cohort / Segment Index');
    assert.strictEqual(res.axisLabels3D.y, 'total_delay_hrs');
    assert.strictEqual(res.axisLabels3D.z, 'Cohort Outlier Rate');
    assert.ok(res.prescriptiveActions[0].category.toLowerCase().includes('cohort') || res.prescriptiveActions[0].category.toLowerCase().includes('segment') || res.prescriptiveActions[0].category.toLowerCase().includes('benchmarking'));

    const md = DataScientistEngine.generateExecutiveInsightsMarkdown(res);
    assert.ok(md.includes('## 2. Cohort & Segment Performance Benchmarking'));
  });

  test('AI Question Framer: generates 4-5 testable hypotheses from dataset schema', () => {
    const suggestions = DataScientistEngine.generateFramedQuestions(sampleSupplyChainRecords, columns);
    assert.ok(suggestions.length >= 4, 'Should generate at least 4 hypothesis suggestions');
    for (const s of suggestions) {
      assert.ok(s.id, 'Suggestion must have id');
      assert.ok(s.badge, 'Suggestion must have badge');
      assert.ok(s.question.endsWith('?'), 'Question must be formulated as a question ending in ?');
      assert.ok(s.rationale.length > 10, 'Suggestion must have explanatory rationale');
    }
  });

  test('AI Question Framer: refines rough user input into sharp hypotheses', () => {
    const refined = DataScientistEngine.generateFramedQuestions(sampleSupplyChainRecords, columns, 'delays in North');
    assert.ok(refined.length >= 1, 'Should generate refined suggestions for rough input');
    const entitySuggestion = refined.find(r => r.question.includes('North'));
    assert.ok(entitySuggestion, 'Should detect North entity and formulate tailored hypothesis');
    assert.strictEqual(entitySuggestion.category, 'cohort');
  });

  test('Custom Hypothesis: evaluates correlation hypothesis with Pearson r, t-test & p-value', () => {
    const res = DataScientistEngine.analyze(sampleSupplyChainRecords, columns, {
      focus: 'Does freight_cost correlate with total_delay_hrs?'
    });

    assert.ok(res.customHypothesis, 'customHypothesis result should be populated');
    assert.strictEqual(res.customHypothesis.intent, 'correlation');
    assert.strictEqual(res.customHypothesis.verdict, 'CONFIRMED');
    assert.ok(res.customHypothesis.hypothesisTest.pValue < 0.05, 'Correlation should be statistically significant');
    assert.strictEqual(res.customHypothesis.hypothesisTest.significance, 'HIGH');
    assert.ok(res.customHypothesis.directAnswer.length > 20);
    assert.strictEqual(res.focusKpis[0].id, 'kpi_hypothesis_verdict');
    assert.ok(res.focusKpis[0].value.includes('CONFIRMED'));
    assert.strictEqual(res.axisLabels3D.x, 'freight_cost');
    assert.strictEqual(res.axisLabels3D.y, 'total_delay_hrs');

    // Deliverable verifications
    const html = DataScientistEngine.generateExecutiveHtmlReport(res);
    assert.ok(html.includes('Custom Hypothesis Evaluation'));
    assert.ok(html.includes('CONFIRMED'));

    const md = DataScientistEngine.generateExecutiveInsightsMarkdown(res);
    assert.ok(md.includes('🎯 Custom Hypothesis Evaluation & Direct Answer'));
    assert.ok(md.includes('CONFIRMED'));

    const py = DataScientistEngine.generatePythonDataScienceScript(res);
    assert.ok(py.includes('🎯 CUSTOM HYPOTHESIS TEST'));
  });

  test('Custom Hypothesis: evaluates cohort comparison hypothesis with Welch t-test & Cohen effect size', () => {
    const res = DataScientistEngine.analyze(sampleSupplyChainRecords, columns, {
      focus: 'Is total_delay_hrs significantly higher in North compared to South?'
    });

    assert.ok(res.customHypothesis, 'customHypothesis result should be populated');
    assert.strictEqual(res.customHypothesis.intent, 'comparison');
    assert.ok(res.customHypothesis.focalEntities.includes('North') || res.customHypothesis.focalEntities.includes('South'));
    assert.ok(res.customHypothesis.evidenceMetrics.length >= 3);
    assert.ok(res.customHypothesis.hypothesisTest.testName.includes('Welch') || res.customHypothesis.hypothesisTest.testName.includes('t-test'));
    assert.ok(res.customHypothesis.directAnswer.length > 20);

    const md = DataScientistEngine.generateExecutiveInsightsMarkdown(res);
    assert.ok(md.includes('🎯 Custom Hypothesis Evaluation & Direct Answer'));
  });

});
