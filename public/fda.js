// fda-comparison.js - Enhanced FDA Drug Comparison and Protocol Analysis

/**
 * FDA Drug Comparison and Protocol Analysis Module
 * 
 * This module enhances the Clinical Trials Explorer with features for:
 * - Comparing similar drugs and their clinical trials
 * - Analyzing protocols and patient numbers
 * - Tracking FDA precedent for similar drugs
 * - Visualizing treatment effects and variability
 */

// Comparison state management
const fdaComparisonState = {
    selectedDrug: null,
    comparisonDrugs: [],
    protocolDetails: {},
    patientDistribution: {},
    fdaGuidance: {},
    treatmentEffects: {},
    loadingComparison: false
  };
  
  // Initialize the FDA comparison module
// Add at the very beginning of the file
console.log("FDA Comparison: Script loading...");

// Make sure removeDrugFromComparison is globally available
window.removeDrugFromComparison = removeDrugFromComparison;

// Add a failsafe check for addLog function that might be missing
if (typeof addLog !== 'function') {
    window.addLog = function(message) {
        console.log("FDA Log:", message);
        // Basic implementation to add to logs if element exists
        const logsContainer = document.getElementById('logsContainer');
        if (logsContainer) {
            const timestamp = new Date().toISOString();
            const logEntry = document.createElement('div');
            logEntry.className = 'mb-2 pb-2 border-b border-gray-200';
            logEntry.innerHTML = `
                <div class="text-xs text-gray-500">${timestamp}</div>
                <div>${message}</div>
            `;
            logsContainer.appendChild(logEntry);
        }
    };
}

// Modify the initFDAComparisonModule function to safely check for elements
function initFDAComparisonModule() {
    console.log("FDA Comparison: Initializing module...");
    
    // Add event listeners with safety checks
    document.getElementById('drugCompareBtn')?.addEventListener('click', performDrugComparison);
    document.getElementById('protocolAnalysisBtn')?.addEventListener('click', analyzeProtocols);
    document.getElementById('variabilityAnalysisBtn')?.addEventListener('click', analyzeVariabilityAndEffect);
    document.getElementById('addComparisonDrugBtn')?.addEventListener('click', addDrugToComparison);
    
    // Initialize the comparison drug list
    updateComparisonDrugsList();
    
    console.log('FDA Comparison and Protocol Analysis Module initialized');
}
  
  // Perform drug comparison - main function to compare a drug with similar ones
  async function performDrugComparison() {
    const drugName = document.getElementById('primaryDrugInput').value.trim();
    if (!drugName) {
      alert('Please enter a primary drug name');
      return;
    }
    
    // Show loading state
    setComparisonLoadingState(true);
    document.getElementById('comparisonResults').classList.remove('hidden');
    
    try {
      // 1. Fetch data for the primary drug
      const primaryDrugData = await fetchDrugTrialData(drugName);
      fdaComparisonState.selectedDrug = primaryDrugData;
      
      // 2. Find similar drugs if no comparison drugs are selected
      if (fdaComparisonState.comparisonDrugs.length === 0) {
        const similarDrugs = await findSimilarDrugs(drugName);
        
        // Add top 3 similar drugs to comparison
        for (let i = 0; i < Math.min(3, similarDrugs.length); i++) {
          const similarDrugData = await fetchDrugTrialData(similarDrugs[i].drugName);
          fdaComparisonState.comparisonDrugs.push(similarDrugData);
        }
      }
      
      // 3. Generate comparison visualizations
      generatePatientNumberComparison();
      generateProtocolComparison();
      generateTreatmentEffectsComparison();
      
      // 4. Try to fetch FDA guidance related to this drug class
      const guidance = await fetchFDAGuidance(drugName);
      if (guidance) {
        displayFDAGuidance(guidance);
      }
      
      // 5. Update the UI with all comparison data
      updateComparisonUI();
      
    } catch (error) {
      console.error('Error in drug comparison:', error);
      document.getElementById('comparisonError').textContent = 
        `Error comparing drugs: ${error.message}`;
      document.getElementById('comparisonError').classList.remove('hidden');
    } finally {
      setComparisonLoadingState(false);
    }
  }
  
  // Set loading state for comparison
  function setComparisonLoadingState(isLoading) {
    fdaComparisonState.loadingComparison = isLoading;
    const loadingElement = document.getElementById('comparisonLoading');
    const resultsElement = document.getElementById('comparisonContent');
    
    if (isLoading) {
      loadingElement.classList.remove('hidden');
      resultsElement.classList.add('opacity-50');
    } else {
      loadingElement.classList.add('hidden');
      resultsElement.classList.remove('opacity-50');
    }
  }
  
  // Fetch clinical trial data for a specific drug
  async function fetchDrugTrialData(drugName) {
    // Construct API URL for the drug trials
    const apiUrl = `/api/studies/search?intervention=${encodeURIComponent(drugName)}&countTotal=true&pageSize=100`;
    
    // Log the API request
    addLog(`Fetching trial data for ${drugName}: GET ${apiUrl}`);
    
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch trial data for ${drugName}`);
    }
    
    const data = await response.json();
    if (!data.success) {
      throw new Error(`API error fetching trial data for ${drugName}`);
    }
    
    // Process the data to extract relevant information
    return processDrugTrialData(drugName, data.data);
  }
  
  // Process trial data for a drug to extract key metrics
  function processDrugTrialData(drugName, trialData) {
    // Initialize processed data structure
    const processedData = {
      drugName,
      totalTrials: trialData.studies.length,
      totalPatients: 0,
      phaseDistribution: {},
      statusDistribution: {},
      averagePatients: 0,
      placeboDifference: null,
      protocols: [],
      completedTrials: 0,
      hasResultsTrials: 0
    };
    
    // Calculate metrics from trial data
    trialData.studies.forEach(study => {
      // Extract protocol section
      const protocol = study.protocolSection || {};
      const design = protocol.designModule || {};
      const status = protocol.statusModule || {};
      
      // Count patients
      if (design.enrollmentInfo && design.enrollmentInfo.count) {
        processedData.totalPatients += design.enrollmentInfo.count;
      }
      
      // Track phases
      const phase = getPhase(study);
      if (phase) {
        processedData.phaseDistribution[phase] = 
          (processedData.phaseDistribution[phase] || 0) + 1;
      }
      
      // Track status
      const overallStatus = status.overallStatus;
      if (overallStatus) {
        processedData.statusDistribution[overallStatus] = 
          (processedData.statusDistribution[overallStatus] || 0) + 1;
      }
      
      // Track completed and results
      if (overallStatus === 'COMPLETED') {
        processedData.completedTrials++;
      }
      
      if (study.hasResults) {
        processedData.hasResultsTrials++;
      }
      
      // Extract protocol details
      if (protocol) {
        processedData.protocols.push({
          nctId: protocol.identificationModule?.nctId,
          title: protocol.identificationModule?.briefTitle,
          phase: phase,
          enrollment: design.enrollmentInfo?.count || 0,
          status: overallStatus,
          hasResults: study.hasResults || false,
          arms: design.armsInterventionsModule?.armGroups?.length || 0,
          primaryOutcomes: protocol.outcomesModule?.primaryOutcomes?.length || 0,
          interventionModel: design.designInfo?.interventionModel || 'Not specified',
          masking: getMaskingInfo(design),
          randomized: isRandomized(design),
          startDate: status.startDateStruct?.date,
          completionDate: status.completionDateStruct?.date
        });
      }
    });
    
    // Calculate averages
    if (processedData.protocols.length > 0) {
      processedData.averagePatients = Math.round(
        processedData.totalPatients / processedData.protocols.length
      );
    }
    
    // Estimate placebo difference (would be extracted from results in a real implementation)
    // For now using a randomized estimation based on drug name for demo
    const hash = hashString(drugName);
    processedData.placeboDifference = 10 + (hash % 30); // Range from 10% to 40%
    
    return processedData;
  }
  
  // Helper function to generate a simple hash from a string
  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }
  
  // Find similar drugs based on the primary drug
  async function findSimilarDrugs(drugName) {
    // This would connect to a real API that finds similar drugs based on classification
    // For demo purposes, we'll use a hardcoded mapping of similar drugs
    
    const similarDrugsMap = {
      'olanzapine': ['risperidone', 'quetiapine', 'aripiprazole', 'ziprasidone'],
      'risperidone': ['olanzapine', 'quetiapine', 'aripiprazole', 'paliperidone'],
      'fluoxetine': ['sertraline', 'paroxetine', 'citalopram', 'escitalopram'],
      'metformin': ['sitagliptin', 'glipizide', 'glyburide', 'pioglitazone'],
      'atorvastatin': ['rosuvastatin', 'simvastatin', 'pravastatin', 'lovastatin'],
      'ibuprofen': ['naproxen', 'celecoxib', 'diclofenac', 'ketoprofen'],
      'amlodipine': ['lisinopril', 'losartan', 'valsartan', 'metoprolol'],
      'insulin': ['metformin', 'liraglutide', 'sitagliptin', 'empagliflozin']
    };
    
    // Get the lowercase version for case-insensitive comparison
    const lowerDrugName = drugName.toLowerCase();
    
    // Try to find the drug in our map
    for (const [key, similarDrugs] of Object.entries(similarDrugsMap)) {
      if (key.includes(lowerDrugName) || lowerDrugName.includes(key)) {
        return similarDrugs.map(drug => ({ drugName: drug }));
      }
      
      // Check if it's in the similar drugs list
      const foundSimilar = similarDrugs.find(
        drug => drug.includes(lowerDrugName) || lowerDrugName.includes(drug)
      );
      
      if (foundSimilar) {
        // Return the key drug and other similar drugs except the one we found
        return [
          { drugName: key },
          ...similarDrugs
            .filter(drug => drug !== foundSimilar)
            .map(drug => ({ drugName: drug }))
        ];
      }
    }
    
    // If no matches found, provide generic fallbacks
    return [
      { drugName: 'aspirin' },
      { drugName: 'acetaminophen' },
      { drugName: 'prednisone' }
    ];
  }
  
  // Fetch FDA guidance related to a drug
  async function fetchFDAGuidance(drugName) {
    // This would connect to a real FDA guidance API
    // For demo purposes, we'll return mock guidance data
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Return mock guidance data
    return {
      title: `FDA Guidance for ${drugName.charAt(0).toUpperCase() + drugName.slice(1)} and Related Compounds`,
      lastUpdated: '2025-01-15',
      recommendations: [
        'Minimum of two adequate and well-controlled studies typically required',
        'Primary endpoint should demonstrate clinically meaningful improvement',
        'Safety database should include a minimum of 1500 patients for chronic use',
        'Studies should include appropriate representation of demographic groups',
        'Long-term safety data (minimum 12 months) required for maintenance indication'
      ],
      patientRecommendations: {
        phase1: '20-80 patients',
        phase2: '100-300 patients',
        phase3: '1000-3000 patients',
        specialPopulations: 'Include at least 20% elderly patients'
      },
      sourceUrl: 'https://www.fda.gov/regulatory-information/search-fda-guidance-documents'
    };
  }
  
  // Generate patient number comparison visualization
  function generatePatientNumberComparison() {
    const comparisonContainer = document.getElementById('patientNumberComparisonChart');
    const ctx = comparisonContainer.getContext('2d');
    
    // Clear any existing chart
    if (fdaComparisonState.patientChart) {
      fdaComparisonState.patientChart.destroy();
    }
    
    // Prepare data for the chart
    const labels = [
      fdaComparisonState.selectedDrug.drugName,
      ...fdaComparisonState.comparisonDrugs.map(drug => drug.drugName)
    ];
    
    const totalPatients = [
      fdaComparisonState.selectedDrug.totalPatients,
      ...fdaComparisonState.comparisonDrugs.map(drug => drug.totalPatients)
    ];
    
    const avgPatients = [
      fdaComparisonState.selectedDrug.averagePatients,
      ...fdaComparisonState.comparisonDrugs.map(drug => drug.averagePatients)
    ];
    
    // Create the chart
    fdaComparisonState.patientChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Total Patients',
            data: totalPatients,
            backgroundColor: 'rgba(54, 162, 235, 0.7)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 1
          },
          {
            label: 'Average Patients per Trial',
            data: avgPatients,
            backgroundColor: 'rgba(255, 159, 64, 0.7)',
            borderColor: 'rgba(255, 159, 64, 1)',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Number of Patients'
            }
          }
        },
        plugins: {
          title: {
            display: true,
            text: 'Patient Numbers Comparison'
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                return `${context.dataset.label}: ${context.raw.toLocaleString()}`;
              }
            }
          }
        }
      }
    });
  }
  
  // Generate protocol comparison
  function generateProtocolComparison() {
    const tableContainer = document.getElementById('protocolComparisonTable');
    
    // Create table structure
    let tableHTML = `
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Protocol Feature</th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">${fdaComparisonState.selectedDrug.drugName}</th>
    `;
    
    // Add headers for comparison drugs
    fdaComparisonState.comparisonDrugs.forEach(drug => {
      tableHTML += `<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">${drug.drugName}</th>`;
    });
    
    tableHTML += `
        </tr>
      </thead>
      <tbody class="bg-white divide-y divide-gray-200">
    `;
    
    // Add rows for each protocol feature
    const protocolFeatures = [
      { name: 'Total Trials', key: 'totalTrials' },
      { name: 'Completed Trials', key: 'completedTrials' },
      { name: 'Trials with Results', key: 'hasResultsTrials' },
      { name: 'Average Patients per Trial', key: 'averagePatients' },
      { name: 'Placebo Difference', key: 'placeboDifference', format: (val) => `${val}%` }
    ];
    
    protocolFeatures.forEach(feature => {
      tableHTML += `
        <tr>
          <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${feature.name}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
            ${feature.format ? feature.format(fdaComparisonState.selectedDrug[feature.key]) : fdaComparisonState.selectedDrug[feature.key]}
          </td>
      `;
      
      fdaComparisonState.comparisonDrugs.forEach(drug => {
        tableHTML += `
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
            ${feature.format ? feature.format(drug[feature.key]) : drug[feature.key]}
          </td>
        `;
      });
      
      tableHTML += `</tr>`;
    });
    
    // Add phase distribution row
    tableHTML += `
      <tr>
        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">Phase Distribution</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          ${formatPhaseDistribution(fdaComparisonState.selectedDrug.phaseDistribution)}
        </td>
    `;
    
    fdaComparisonState.comparisonDrugs.forEach(drug => {
      tableHTML += `
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          ${formatPhaseDistribution(drug.phaseDistribution)}
        </td>
      `;
    });
    
    tableHTML += `
      </tr>
      </tbody>
      </table>
    `;
    
    // Set the table HTML
    tableContainer.innerHTML = tableHTML;
  }
  
  // Format phase distribution for display
  function formatPhaseDistribution(phaseDistribution) {
    if (!phaseDistribution || Object.keys(phaseDistribution).length === 0) {
      return 'No data';
    }
    
    return Object.entries(phaseDistribution)
      .sort(([phaseA], [phaseB]) => {
        // Custom sort to keep phases in order
        const phaseOrder = {
          'Early Phase 1': 0,
          'Phase 1': 1,
          'Phase 2': 2,
          'Phase 3': 3,
          'Phase 4': 4,
          'Not Applicable': 5
        };
        return (phaseOrder[phaseA] || 99) - (phaseOrder[phaseB] || 99);
      })
      .map(([phase, count]) => `${phase}: ${count}`)
      .join('<br>');
  }
  
  // Generate treatment effects comparison
  function generateTreatmentEffectsComparison() {
    const comparisonContainer = document.getElementById('treatmentEffectsComparisonChart');
    const ctx = comparisonContainer.getContext('2d');
    
    // Clear any existing chart
    if (fdaComparisonState.effectsChart) {
      fdaComparisonState.effectsChart.destroy();
    }
    
    // Prepare data for the chart
    const labels = [
      fdaComparisonState.selectedDrug.drugName,
      ...fdaComparisonState.comparisonDrugs.map(drug => drug.drugName)
    ];
    
    // Get placebo differences
    const placeboDifferences = [
      fdaComparisonState.selectedDrug.placeboDifference,
      ...fdaComparisonState.comparisonDrugs.map(drug => drug.placeboDifference)
    ];
    
    // Create variability data (higher variability means more patients needed)
    // This would be calculated from actual data in a real implementation
    const variabilityData = placeboDifferences.map(diff => {
      // For demo, simulate inverse relationship between effect size and variability
      return Math.max(5, 50 - diff * 0.8);
    });
    
    // Create the chart
    fdaComparisonState.effectsChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Treatment Effect (%)',
            data: placeboDifferences,
            backgroundColor: 'rgba(75, 192, 192, 0.7)',
            borderColor: 'rgba(75, 192, 192, 1)',
            borderWidth: 1,
            yAxisID: 'y'
          },
          {
            label: 'Variability',
            data: variabilityData,
            backgroundColor: 'rgba(255, 99, 132, 0.7)',
            borderColor: 'rgba(255, 99, 132, 1)',
            borderWidth: 1,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true,
            position: 'left',
            title: {
              display: true,
              text: 'Treatment Effect (%)'
            }
          },
          y1: {
            beginAtZero: true,
            position: 'right',
            grid: {
              drawOnChartArea: false
            },
            title: {
              display: true,
              text: 'Variability (higher = more patients needed)'
            }
          }
        },
        plugins: {
          title: {
            display: true,
            text: 'Treatment Effects & Variability Comparison'
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const label = context.dataset.label;
                const value = context.raw;
                if (label === 'Treatment Effect (%)') {
                  return `${label}: ${value}%`;
                }
                return `${label}: ${value}`;
              }
            }
          }
        }
      }
    });
  }
  
  // Display FDA guidance
  function displayFDAGuidance(guidance) {
    const guidanceContainer = document.getElementById('fdaGuidanceSection');
    
    // Create guidance HTML
    let guidanceHTML = `
      <div class="bg-blue-50 p-4 rounded-md border border-blue-200">
        <h3 class="text-lg font-medium text-blue-800 mb-2">${guidance.title}</h3>
        <p class="text-sm text-blue-600 mb-3">Last Updated: ${guidance.lastUpdated}</p>
        
        <h4 class="font-medium text-blue-700 mb-2">Key Recommendations:</h4>
        <ul class="list-disc list-inside mb-3 text-sm text-blue-800 space-y-1">
    `;
    
    // Add recommendations
    guidance.recommendations.forEach(recommendation => {
      guidanceHTML += `<li>${recommendation}</li>`;
    });
    
    guidanceHTML += `
        </ul>
        
        <h4 class="font-medium text-blue-700 mb-2">Patient Enrollment Recommendations:</h4>
        <ul class="list-disc list-inside text-sm text-blue-800 space-y-1">
          <li>Phase 1: ${guidance.patientRecommendations.phase1}</li>
          <li>Phase 2: ${guidance.patientRecommendations.phase2}</li>
          <li>Phase 3: ${guidance.patientRecommendations.phase3}</li>
          <li>Special Populations: ${guidance.patientRecommendations.specialPopulations}</li>
        </ul>
        
        <div class="mt-3 text-xs text-blue-600">
          Source: <a href="${guidance.sourceUrl}" target="_blank" class="underline hover:text-blue-800">FDA Guidance Documents</a>
        </div>
      </div>
    `;
    
    // Set the guidance HTML
    guidanceContainer.innerHTML = guidanceHTML;
    guidanceContainer.classList.remove('hidden');
  }
  
  // Add a drug to the comparison list
  function addDrugToComparison() {
    const drugName = document.getElementById('additionalDrugInput').value.trim();
    if (!drugName) {
      alert('Please enter a drug name to add to comparison');
      return;
    }
    
    // Show loading state
    setComparisonLoadingState(true);
    
    // Fetch data for the drug
    fetchDrugTrialData(drugName)
      .then(drugData => {
        // Add to comparison drugs
        fdaComparisonState.comparisonDrugs.push(drugData);
        
        // Update the comparison UI
        updateComparisonDrugsList();
        
        // If we have a primary drug selected, update the visualizations
        if (fdaComparisonState.selectedDrug) {
          generatePatientNumberComparison();
          generateProtocolComparison();
          generateTreatmentEffectsComparison();
        }
        
        // Clear the input
        document.getElementById('additionalDrugInput').value = '';
      })
      .catch(error => {
        console.error('Error adding drug to comparison:', error);
        alert(`Error adding drug to comparison: ${error.message}`);
      })
      .finally(() => {
        setComparisonLoadingState(false);
      });
  }
  
  // Update the list of drugs being compared
  function updateComparisonDrugsList() {
    const drugsListContainer = document.getElementById('comparisonDrugsList');
    
    if (!fdaComparisonState.comparisonDrugs || fdaComparisonState.comparisonDrugs.length === 0) {
      drugsListContainer.innerHTML = '<div class="text-gray-500 italic">No drugs added for comparison</div>';
      return;
    }
    
    let drugsHTML = '<ul class="space-y-1">';
    
    fdaComparisonState.comparisonDrugs.forEach((drug, index) => {
      drugsHTML += `
        <li class="flex items-center justify-between">
          <span>${drug.drugName}</span>
          <button 
            class="text-red-600 hover:text-red-800" 
            onclick="removeDrugFromComparison(${index})"
          >
            Remove
          </button>
        </li>
      `;
    });
    
    drugsHTML += '</ul>';
    drugsListContainer.innerHTML = drugsHTML;
  }
  
  // Remove a drug from the comparison list
  function removeDrugFromComparison(index) {
    fdaComparisonState.comparisonDrugs.splice(index, 1);
    
    // Update the UI
    updateComparisonDrugsList();
    
    // If we have a primary drug selected, update the visualizations
    if (fdaComparisonState.selectedDrug) {
      generatePatientNumberComparison();
      generateProtocolComparison();
      generateTreatmentEffectsComparison();
    }
  }
  
  // Analyze protocols in detail
  function analyzeProtocols() {
    if (!fdaComparisonState.selectedDrug) {
      alert('Please select a primary drug first');
      return;
    }
    
    // Get the protocol details from the selected drug
    const protocols = fdaComparisonState.selectedDrug.protocols;
    
    // Show the protocol analysis section
    document.getElementById('protocolAnalysisSection').classList.remove('hidden');
    
    // Create table for protocol details
    const tableContainer = document.getElementById('protocolDetailsTable');
    
    let tableHTML = `
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">NCT ID</th>
            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Title</th>
            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phase</th>
            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Enrollment</th>
            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Model</th>
            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Arms</th>
            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Randomized</th>
            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Has Results</th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
    `;
    
    // Add rows for each protocol
    protocols.forEach(protocol => {
      tableHTML += `
        <tr>
          <td class="px-4 py-4 whitespace-nowrap text-sm font-medium text-indigo-600">
            <a href="https://clinicaltrials.gov/study/${protocol.nctId}" target="_blank">${protocol.nctId}</a>
          </td>
          <td class="px-4 py-4 whitespace-normal text-sm text-gray-900 max-w-xs truncate" title="${protocol.title}">${protocol.title}</td>
          <td class="px-4 py-4 whitespace-nowrap text-sm text-gray-500">${protocol.phase || 'N/A'}</td>
          <td class="px-4 py-4 whitespace-nowrap text-sm text-gray-500">${protocol.enrollment.toLocaleString()}</td>
          <td class="px-4 py-4 whitespace-nowrap text-sm text-gray-500">${protocol.status || 'N/A'}</td>
        <td class="px-4 py-4 whitespace-nowrap text-sm text-gray-500">${protocol.interventionModel}</td>
        <td class="px-4 py-4 whitespace-nowrap text-sm text-gray-500">${protocol.arms}</td>
        <td class="px-4 py-4 whitespace-nowrap text-sm text-gray-500">${protocol.randomized ? 'Yes' : 'No'}</td>
        <td class="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
          ${protocol.hasResults ? 
            '<span class="text-green-600">Yes</span>' : 
            '<span class="text-red-600">No</span>'}
        </td>
      </tr>
    `;
  });
  
  tableHTML += `
      </tbody>
    </table>
  `;
  
  // Set the table HTML
  tableContainer.innerHTML = tableHTML;
  
  // Create protocol summary visualizations
  createProtocolSummaryCharts();
}

// Create summary charts for protocol analysis
function createProtocolSummaryCharts() {
  if (!fdaComparisonState.selectedDrug || !fdaComparisonState.selectedDrug.protocols) {
    return;
  }
  
  const protocols = fdaComparisonState.selectedDrug.protocols;
  
  // Create study design chart (intervention model distribution)
  createStudyDesignChart(protocols);
  
  // Create patient distribution by phase chart
  createPatientsByPhaseChart(protocols);
  
  // Create timeline chart showing start and completion dates
  createTimelineChart(protocols);
}

// Create study design distribution chart
function createStudyDesignChart(protocols) {
  const chartContainer = document.getElementById('studyDesignChart');
  const ctx = chartContainer.getContext('2d');
  
  // Clear any existing chart
  if (fdaComparisonState.designChart) {
    fdaComparisonState.designChart.destroy();
  }
  
  // Count intervention models
  const interventionModels = {};
  protocols.forEach(protocol => {
    const model = protocol.interventionModel;
    if (model) {
      interventionModels[model] = (interventionModels[model] || 0) + 1;
    }
  });
  
  // Prepare data for the chart
  const labels = Object.keys(interventionModels);
  const data = Object.values(interventionModels);
  
  // Define colors
  const colors = [
    'rgba(54, 162, 235, 0.7)',
    'rgba(255, 99, 132, 0.7)',
    'rgba(255, 206, 86, 0.7)',
    'rgba(75, 192, 192, 0.7)',
    'rgba(153, 102, 255, 0.7)'
  ];
  
  // Create the chart
  fdaComparisonState.designChart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors.slice(0, labels.length),
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: 'Study Design Distribution'
        },
        legend: {
          position: 'right'
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const value = context.raw;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = Math.round((value / total) * 100);
              return `${context.label}: ${value} (${percentage}%)`;
            }
          }
        }
      }
    }
  });
}

// Create patients by phase chart
function createPatientsByPhaseChart(protocols) {
  const chartContainer = document.getElementById('patientsByPhaseChart');
  const ctx = chartContainer.getContext('2d');
  
  // Clear any existing chart
  if (fdaComparisonState.phaseChart) {
    fdaComparisonState.phaseChart.destroy();
  }
  
  // Group protocols by phase and count patients
  const phasePatients = {};
  const phaseTrials = {};
  
  protocols.forEach(protocol => {
    const phase = protocol.phase || 'Not Specified';
    if (!phasePatients[phase]) {
      phasePatients[phase] = 0;
      phaseTrials[phase] = 0;
    }
    phasePatients[phase] += protocol.enrollment;
    phaseTrials[phase]++;
  });
  
  // Calculate average patients per phase
  const phaseAvgPatients = {};
  Object.keys(phasePatients).forEach(phase => {
    phaseAvgPatients[phase] = Math.round(phasePatients[phase] / phaseTrials[phase]);
  });
  
  // Sort phases for display
  const sortedPhases = Object.keys(phasePatients).sort((a, b) => {
    const phaseOrder = {
      'Early Phase 1': 0,
      'Phase 1': 1,
      'Phase 1/Phase 2': 2,
      'Phase 2': 3,
      'Phase 2/Phase 3': 4,
      'Phase 3': 5,
      'Phase 4': 6,
      'Not Applicable': 7,
      'Not Specified': 8
    };
    return (phaseOrder[a] || 99) - (phaseOrder[b] || 99);
  });
  
  // Prepare data for the chart
  const labels = sortedPhases;
  const totalPatientsData = sortedPhases.map(phase => phasePatients[phase]);
  const avgPatientsData = sortedPhases.map(phase => phaseAvgPatients[phase]);
  
  // Create the chart
  fdaComparisonState.phaseChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Total Patients',
          data: totalPatientsData,
          backgroundColor: 'rgba(54, 162, 235, 0.7)',
          borderColor: 'rgba(54, 162, 235, 1)',
          borderWidth: 1,
          yAxisID: 'y'
        },
        {
          label: 'Average Patients per Trial',
          data: avgPatientsData,
          backgroundColor: 'rgba(255, 99, 132, 0.7)',
          borderColor: 'rgba(255, 99, 132, 1)',
          borderWidth: 1,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true,
          position: 'left',
          title: {
            display: true,
            text: 'Total Patients'
          }
        },
        y1: {
          beginAtZero: true,
          position: 'right',
          grid: {
            drawOnChartArea: false
          },
          title: {
            display: true,
            text: 'Average Patients per Trial'
          }
        }
      },
      plugins: {
        title: {
          display: true,
          text: 'Patient Distribution by Phase'
        }
      }
    }
  });
}

// Create timeline chart
function createTimelineChart(protocols) {
  const chartContainer = document.getElementById('timelineChart');
  const ctx = chartContainer.getContext('2d');
  
  // Clear any existing chart
  if (fdaComparisonState.timelineChart) {
    fdaComparisonState.timelineChart.destroy();
  }
  
  // Filter protocols with valid dates
  const protocolsWithDates = protocols.filter(
    p => p.startDate && p.completionDate
  );
  
  // Sort by start date
  protocolsWithDates.sort((a, b) => 
    new Date(a.startDate) - new Date(b.startDate)
  );
  
  // Limit to 10 protocols for readability
  const displayProtocols = protocolsWithDates.slice(0, 10);
  
  // Convert dates to timestamps
  displayProtocols.forEach(p => {
    p.startTimestamp = new Date(p.startDate).getTime();
    p.completionTimestamp = new Date(p.completionDate).getTime();
    p.duration = p.completionTimestamp - p.startTimestamp;
  });
  
  // Prepare data for the chart
  const labels = displayProtocols.map(p => p.nctId);
  const data = displayProtocols.map(p => ({
    x: p.startTimestamp,
    y: labels.indexOf(p.nctId),
    x2: p.completionTimestamp
  }));
  
  // Create the chart
  fdaComparisonState.timelineChart = new Chart(ctx, {
    type: 'scatter',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: 'rgba(54, 162, 235, 0.7)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 1,
        pointRadius: 6,
        pointHoverRadius: 8
      }]
    },
    options: {
      responsive: true,
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'month',
            displayFormats: {
              month: 'MMM YYYY'
            }
          },
          title: {
            display: true,
            text: 'Timeline'
          }
        },
        y: {
          type: 'category',
          labels: labels,
          reverse: true,
          title: {
            display: true,
            text: 'Study ID'
          }
        }
      },
      plugins: {
        title: {
          display: true,
          text: 'Study Timeline'
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const index = context.dataIndex;
              const protocol = displayProtocols[index];
              const startDate = new Date(protocol.startDate).toLocaleDateString();
              const endDate = new Date(protocol.completionDate).toLocaleDateString();
              const duration = Math.round(protocol.duration / (1000 * 60 * 60 * 24 * 30)); // months
              
              return [
                `NCT ID: ${protocol.nctId}`,
                `Phase: ${protocol.phase || 'N/A'}`,
                `Start: ${startDate}`,
                `End: ${endDate}`,
                `Duration: ~${duration} months`,
                `Patients: ${protocol.enrollment.toLocaleString()}`
              ];
            }
          }
        }
      }
    },
    plugins: [{
      id: 'timeline',
      beforeDraw: (chart) => {
        const ctx = chart.ctx;
        const xAxis = chart.scales.x;
        const yAxis = chart.scales.y;
        
        // Draw timeline bars
        ctx.save();
        ctx.lineWidth = 10;
        ctx.strokeStyle = 'rgba(54, 162, 235, 0.5)';
        
        displayProtocols.forEach((protocol, i) => {
          const startX = xAxis.getPixelForValue(protocol.startTimestamp);
          const endX = xAxis.getPixelForValue(protocol.completionTimestamp);
          const y = yAxis.getPixelForValue(protocol.nctId);
          
          ctx.beginPath();
          ctx.moveTo(startX, y);
          ctx.lineTo(endX, y);
          ctx.stroke();
        });
        
        ctx.restore();
      }
    }]
  });
}

// Analyze variability and treatment effect
function analyzeVariabilityAndEffect() {
  if (!fdaComparisonState.selectedDrug) {
    alert('Please select a primary drug first');
    return;
  }
  
  // Show the variability analysis section
  document.getElementById('variabilityAnalysisSection').classList.remove('hidden');
  
  // Create bell curve visualization
  createBellCurveVisualization();
  
  // Create patient number estimation table
  createPatientEstimationTable();
}

// Create bell curve visualization for placebo vs treatment
function createBellCurveVisualization() {
  const chartContainer = document.getElementById('bellCurveChart');
  const ctx = chartContainer.getContext('2d');
  
  // Clear any existing chart
  if (fdaComparisonState.bellCurveChart) {
    fdaComparisonState.bellCurveChart.destroy();
  }
  
  // Generate bell curve data
  // This would use actual statistical data in a real implementation
  // For demo, we'll create synthetic data based on the drug's estimated effect
  
  const drugName = fdaComparisonState.selectedDrug.drugName;
  const treatmentEffect = fdaComparisonState.selectedDrug.placeboDifference;
  
  // Parameters for the normal distributions
  const placeboMean = 30;
  const placeboStdDev = 10;
  const treatmentMean = placeboMean + treatmentEffect;
  const treatmentStdDev = placeboStdDev;
  
  // Generate points for the curves
  const points = 100;
  const xMin = Math.min(placeboMean, treatmentMean) - 3 * Math.max(placeboStdDev, treatmentStdDev);
  const xMax = Math.max(placeboMean, treatmentMean) + 3 * Math.max(placeboStdDev, treatmentStdDev);
  const step = (xMax - xMin) / points;
  
  const xValues = Array.from({ length: points + 1 }, (_, i) => xMin + i * step);
  const placeboValues = xValues.map(x => normalPDF(x, placeboMean, placeboStdDev));
  const treatmentValues = xValues.map(x => normalPDF(x, treatmentMean, treatmentStdDev));
  
  // Normalize the curves to have the same max height
  const placeboMax = Math.max(...placeboValues);
  const treatmentMax = Math.max(...treatmentValues);
  const normalizedPlaceboValues = placeboValues.map(y => y / placeboMax);
  const normalizedTreatmentValues = treatmentValues.map(y => y / treatmentMax);
  
  // Create the chart
  fdaComparisonState.bellCurveChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: xValues,
      datasets: [
        {
          label: 'Placebo Response',
          data: normalizedPlaceboValues,
          borderColor: 'rgba(255, 99, 132, 1)',
          backgroundColor: 'rgba(255, 99, 132, 0.2)',
          borderWidth: 2,
          fill: true,
          tension: 0.4
        },
        {
          label: `${drugName} Response`,
          data: normalizedTreatmentValues,
          borderColor: 'rgba(54, 162, 235, 1)',
          backgroundColor: 'rgba(54, 162, 235, 0.2)',
          borderWidth: 2,
          fill: true,
          tension: 0.4
        }
      ]
    },
    options: {
      responsive: true,
      scales: {
        x: {
          title: {
            display: true,
            text: 'Response Measure'
          }
        },
        y: {
          display: false
        }
      },
      plugins: {
        title: {
          display: true,
          text: 'Distribution of Responses: Placebo vs. Treatment'
        },
        annotation: {
          annotations: {
            line1: {
              type: 'line',
              xMin: placeboMean,
              xMax: placeboMean,
              borderColor: 'rgba(255, 99, 132, 0.7)',
              borderWidth: 2,
              label: {
                content: 'Placebo Mean',
                enabled: true,
                position: 'top'
              }
            },
            line2: {
              type: 'line',
              xMin: treatmentMean,
              xMax: treatmentMean,
              borderColor: 'rgba(54, 162, 235, 0.7)',
              borderWidth: 2,
              label: {
                content: 'Treatment Mean',
                enabled: true,
                position: 'top'
              }
            },
            box1: {
              type: 'box',
              xMin: placeboMean,
              xMax: treatmentMean,
              backgroundColor: 'rgba(75, 192, 192, 0.2)',
              borderColor: 'rgba(75, 192, 192, 0.7)',
              borderWidth: 2,
              label: {
                content: `Treatment Effect: ${treatmentEffect}%`,
                enabled: true,
                position: 'center'
              }
            }
          }
        }
      }
    }
  });
  
  // Add annotation explaining the chart
  const annotationContainer = document.getElementById('bellCurveAnnotation');
  annotationContainer.innerHTML = `
    <div class="bg-gray-50 p-4 rounded-md border border-gray-200 mt-4">
      <h4 class="font-medium text-gray-700 mb-2">Understanding Treatment Effect & Variability</h4>
      <p class="text-sm text-gray-600 mb-2">
        This visualization shows the estimated distribution of responses for both placebo and 
        ${drugName} treatment groups.
      </p>
      <ul class="list-disc list-inside text-sm text-gray-600 space-y-1">
        <li><span class="text-red-500 font-medium">Red curve</span> shows the placebo response distribution</li>
        <li><span class="text-blue-500 font-medium">Blue curve</span> shows the ${drugName} response distribution</li>
        <li>The separation between curves represents the <span class="font-medium">treatment effect</span> (${treatmentEffect}%)</li>
        <li>The width of each curve represents the <span class="font-medium">variability</span> in responses</li>
        <li>Greater overlap between curves requires <span class="font-medium">more patients</span> to demonstrate statistical significance</li>
      </ul>
    </div>
  `;
}

// Normal probability density function
function normalPDF(x, mean, stdDev) {
  return (1 / (stdDev * Math.sqrt(2 * Math.PI))) * 
    Math.exp(-0.5 * Math.pow((x - mean) / stdDev, 2));
}

// Create patient estimation table
function createPatientEstimationTable() {
  const tableContainer = document.getElementById('patientEstimationTable');
  
  // Get treatment effect and other metrics
  const drugName = fdaComparisonState.selectedDrug.drugName;
  const treatmentEffect = fdaComparisonState.selectedDrug.placeboDifference;
  const actualAvgPatients = fdaComparisonState.selectedDrug.averagePatients;
  
  // Calculate estimated patient numbers based on different effect sizes and variability
  // These would be based on actual statistical power calculations in a real implementation
  const patientEstimates = [
    { effectSize: treatmentEffect * 0.5, variability: 'High', patients: Math.round(actualAvgPatients * 4) },
    { effectSize: treatmentEffect * 0.5, variability: 'Medium', patients: Math.round(actualAvgPatients * 2.5) },
    { effectSize: treatmentEffect * 0.5, variability: 'Low', patients: Math.round(actualAvgPatients * 1.5) },
    { effectSize: treatmentEffect, variability: 'High', patients: Math.round(actualAvgPatients * 2) },
    { effectSize: treatmentEffect, variability: 'Medium', patients: actualAvgPatients },
    { effectSize: treatmentEffect, variability: 'Low', patients: Math.round(actualAvgPatients * 0.7) },
    { effectSize: treatmentEffect * 1.5, variability: 'High', patients: Math.round(actualAvgPatients * 0.9) },
    { effectSize: treatmentEffect * 1.5, variability: 'Medium', patients: Math.round(actualAvgPatients * 0.6) },
    { effectSize: treatmentEffect * 1.5, variability: 'Low', patients: Math.round(actualAvgPatients * 0.4) }
  ];
  
  // Create table HTML
  let tableHTML = `
    <h4 class="font-medium text-gray-700 mb-2">Estimated Patients Needed Based on Effect Size & Variability</h4>
    <table class="min-w-full divide-y divide-gray-200">
      <thead class="bg-gray-50">
        <tr>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Effect Size</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Variability</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estimated Patients Needed</th>
        </tr>
      </thead>
      <tbody class="bg-white divide-y divide-gray-200">
  `;
  
  // Add rows for each estimate
  patientEstimates.forEach(estimate => {
    const isCurrentEstimate = estimate.effectSize === treatmentEffect && 
                              estimate.variability === 'Medium';
    
    tableHTML += `
      <tr class="${isCurrentEstimate ? 'bg-blue-50' : ''}">
        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium ${isCurrentEstimate ? 'text-blue-700' : 'text-gray-900'}">
          ${estimate.effectSize}% ${isCurrentEstimate ? '(Current)' : ''}
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          ${estimate.variability}
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          ${estimate.patients.toLocaleString()}
        </td>
      </tr>
    `;
  });
  
  tableHTML += `
      </tbody>
    </table>
    <p class="text-sm text-gray-500 mt-2">
      Current estimated effect size for ${drugName}: <span class="font-medium">${treatmentEffect}%</span>
    </p>
  `;
  
  // Set the table HTML
  tableContainer.innerHTML = tableHTML;
}

// Update the overall comparison UI
function updateComparisonUI() {
  // Show the comparison results container
  document.getElementById('comparisonResults').classList.remove('hidden');
  
  // Update the drug name in the title
  const drugNameElement = document.getElementById('primaryDrugName');
  if (drugNameElement) {
    drugNameElement.textContent = fdaComparisonState.selectedDrug.drugName;
  }
  
  // Create a summary card with key metrics
  updateSummaryCard();
}

// Update the summary card with key metrics
function updateSummaryCard() {
  const cardContainer = document.getElementById('drugSummaryCard');
  
  if (!fdaComparisonState.selectedDrug) {
    return;
  }
  
  const drug = fdaComparisonState.selectedDrug;
  
  cardContainer.innerHTML = `
    <div class="bg-white p-6 rounded-lg shadow-md border border-gray-200">
      <h3 class="text-xl font-semibold text-gray-800 mb-4">${drug.drugName} Summary</h3>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <div class="text-sm font-medium text-gray-500">Total Trials</div>
          <div class="text-xl font-semibold text-gray-800">${drug.totalTrials}</div>
        </div>
        
        <div>
          <div class="text-sm font-medium text-gray-500">Total Patients</div>
          <div class="text-xl font-semibold text-gray-800">${drug.totalPatients.toLocaleString()}</div>
        </div>
        
        <div>
          <div class="text-sm font-medium text-gray-500">Completed Trials</div>
          <div class="text-xl font-semibold text-gray-800">${drug.completedTrials}</div>
        </div>
        
        <div>
          <div class="text-sm font-medium text-gray-500">Trials with Results</div>
          <div class="text-xl font-semibold text-gray-800">${drug.hasResultsTrials}</div>
        </div>
        
        <div>
          <div class="text-sm font-medium text-gray-500">Average Patients/Trial</div>
          <div class="text-xl font-semibold text-gray-800">${drug.averagePatients.toLocaleString()}</div>
        </div>
        
        <div>
          <div class="text-sm font-medium text-gray-500">Est. Treatment Effect</div>
          <div class="text-xl font-semibold text-green-600">${drug.placeboDifference}%</div>
        </div>
      </div>
      
      <div class="mt-4 pt-4 border-t border-gray-200">
        <h4 class="text-sm font-medium text-gray-500 mb-2">Phase Distribution</h4>
        <div class="text-sm grid grid-cols-2 gap-2">
          ${formatPhaseDistributionCard(drug.phaseDistribution)}
        </div>
      </div>
    </div>
  `;
}

// Format phase distribution for the summary card
function formatPhaseDistributionCard(phaseDistribution) {
  if (!phaseDistribution || Object.keys(phaseDistribution).length === 0) {
    return '<div>No data available</div>';
  }
  
  return Object.entries(phaseDistribution)
    .sort(([phaseA], [phaseB]) => {
      // Custom sort to keep phases in order
      const phaseOrder = {
        'Early Phase 1': 0,
        'Phase 1': 1,
        'Phase 2': 2,
        'Phase 3': 3,
        'Phase 4': 4,
        'Not Applicable': 5
      };
      return (phaseOrder[phaseA] || 99) - (phaseOrder[phaseB] || 99);
    })
    .map(([phase, count]) => `<div>${phase}: <span class="font-semibold">${count}</span></div>`)
    .join('');
}

// Helper function to get masking information
function getMaskingInfo(design) {
  if (!design || !design.designInfo || !design.designInfo.masking) {
    return 'None';
  }
  
  return design.designInfo.masking;
}

// Helper function to determine if study is randomized
function isRandomized(design) {
  if (!design || !design.designInfo) {
    return false;
  }
  
  // Check if randomization is mentioned in the model
  const model = design.designInfo.interventionModel || '';
  if (model.toLowerCase().includes('random')) {
    return true;
  }
  
  // Check allocation field if exists
  const allocation = design.designInfo.allocation || '';
  return allocation.toLowerCase().includes('random');
}

// Add the removeDrugFromComparison function to the window object
// so it can be called from the HTML
window.removeDrugFromComparison = removeDrugFromComparison;

// Initialize the FDA comparison module when the page loads
document.addEventListener('DOMContentLoaded', function() {
  if (document.getElementById('fdaComparisonSection')) {
    initFDAComparisonModule();
  }
});