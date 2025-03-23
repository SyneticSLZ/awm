/**
 * Enhanced Clinical Trial Outcome Visualization
 * This utility creates dynamic visualizations for clinical trial outcome data,
 * handling various data structures and presentation formats.
 */

// Function to create outcome charts based on study data
function createOutcomeCharts(study) {
    const outcomes = study.resultsSection?.outcomeMeasuresModule?.outcomeMeasures || [];
    const nctId = study.protocolSection?.identificationModule?.nctId || 'unknown';
    
    if (!outcomes.length) {
        console.log('No outcome measures available for visualization');
        return;
    }
    
    // Create charts for primary outcomes
    const primaryOutcomes = outcomes.filter(outcome => outcome.type === 'PRIMARY');
    primaryOutcomes.forEach((outcome, idx) => {
        const canvasId = `outcome_${nctId}_${idx}`;
        const canvas = document.getElementById(canvasId);
        
        if (!canvas) {
            console.warn(`Canvas element not found for ${canvasId}`);
            return;
        }
        
        createOutcomeVisualization(outcome, canvas);
    });
    
    // Create charts for secondary outcomes
    const secondaryOutcomes = outcomes.filter(outcome => outcome.type === 'SECONDARY');
    secondaryOutcomes.forEach((outcome, idx) => {
        const canvasId = `outcome_secondary_${nctId}_${idx}`;
        const canvas = document.getElementById(canvasId);
        
        if (!canvas) {
            console.warn(`Canvas element not found for ${canvasId}`);
            return;
        }
        
        createOutcomeVisualization(outcome, canvas);
    });
}

// Main function to create appropriate outcome visualization based on data type
function createOutcomeVisualization(outcome, canvas) {
    // Check if outcome has required data
    if (!outcome || !canvas) return;
    
    // Extract relevant data
    const title = outcome.title || 'Outcome Measure';
    const timeFrame = outcome.timeFrame || 'Not specified';
    const paramType = outcome.paramType || '';
    const groups = outcome.groups || [];
    const classes = outcome.classes || [];
    
    // Create container div for enhanced UI
    const container = document.createElement('div');
    container.className = 'outcome-chart-container relative';
    container.style.width = '100%';
    container.style.height = '100%';
    canvas.parentNode.insertBefore(container, canvas);
    container.appendChild(canvas);
    
    // Add full screen button
    const fullScreenBtn = document.createElement('button');
    fullScreenBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M1.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4A1.5 1.5 0 0 1 1.5 0h4a.5.5 0 0 1 0 1h-4zM10 .5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 16 1.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zM.5 10a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 0 14.5v-4a.5.5 0 0 1 .5-.5zm15 0a.5.5 0 0 1 .5.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5z"/></svg>';
    fullScreenBtn.className = 'absolute top-2 right-2 bg-white p-1 rounded-md shadow hover:bg-gray-100 z-10';
    fullScreenBtn.title = 'Full Screen';
    container.appendChild(fullScreenBtn);
    
    // Add interpretation container
    const interpretationContainer = document.createElement('div');
    interpretationContainer.className = 'outcome-interpretation mt-3 p-2 bg-gray-50 rounded text-sm hidden';
    container.appendChild(interpretationContainer);
    
    // Attempt to detect outcome data structure and create appropriate visualization
    if (hasDistributionData(outcome)) {
        createDistributionChart(outcome, canvas, interpretationContainer);
    } else if (hasCategoricalData(outcome)) {
        createCategoricalChart(outcome, canvas, interpretationContainer);
    } else if (hasTimePointData(outcome)) {
        createTimeSeriesChart(outcome, canvas, interpretationContainer);
    } else {
        // Fallback to simple bar chart if no specific structure detected
        createSimpleBarChart(outcome, canvas, interpretationContainer);
    }
    
    // Set up full screen functionality
    fullScreenBtn.addEventListener('click', () => {
        toggleFullScreen(container);
        
        // Show interpretation when in full screen
        interpretationContainer.classList.toggle('hidden');
    });
}

// Helper function to toggle full screen for chart
function toggleFullScreen(container) {
    if (!document.fullscreenElement) {
        // Create modal for fullscreen view
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-90 flex items-center justify-center z-50';
        
        const modalContent = document.createElement('div');
        modalContent.className = 'bg-white rounded-lg p-4 max-w-4xl w-full max-h-90vh overflow-auto';
        
        const closeBtn = document.createElement('button');
        closeBtn.className = 'absolute top-4 right-4 text-white hover:text-gray-200';
        closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>';
        
        modal.appendChild(closeBtn);
        modal.appendChild(modalContent);
        
        // Clone the container content for the modal
        const clone = container.cloneNode(true);
        clone.style.height = '500px';
        clone.querySelector('.outcome-interpretation').classList.remove('hidden');
        
        modalContent.appendChild(clone);
        document.body.appendChild(modal);
        
        // Set up chart recreation in modal
        const originalCanvas = container.querySelector('canvas');
        const clonedCanvas = clone.querySelector('canvas');
        
        // Transfer chart to cloned canvas
        if (originalCanvas._chart) {
            const config = originalCanvas._chart.config;
            new Chart(clonedCanvas, config);
        }
        
        // Close modal on button click
        closeBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
        });
    }
}

// Check if outcome has distribution-like data suitable for bell curve
function hasDistributionData(outcome) {
    if (!outcome.groups || !outcome.classes) return false;
    
    // Check for mean and standard deviation/error in measurements
    let hasMeanAndVariance = false;
    
    // Look for paramType indicating mean/average
    const isMeanParam = outcome.paramType === 'MEAN' || 
                       outcome.paramType === 'LEAST_SQUARES_MEAN' || 
                       outcome.paramType === 'GEOMETRIC_MEAN';
    
    // Look for dispersion type indicating variance
    const hasVariance = outcome.dispersionType === 'Standard Deviation' || 
                       outcome.dispersionType === 'Standard Error' || 
                       outcome.dispersionType === 'STANDARD_DEVIATION' || 
                       outcome.dispersionType === 'STANDARD_ERROR';
    
    // If class measurements have spread/dispersion values
    if (outcome.classes && outcome.classes.length > 0) {
        for (const cls of outcome.classes) {
            if (cls.categories && cls.categories.length > 0) {
                for (const cat of cls.categories) {
                    if (cat.measurements && cat.measurements.length > 0) {
                        for (const measurement of cat.measurements) {
                            if (measurement.value && (measurement.spread || measurement.dispersion)) {
                                hasMeanAndVariance = true;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
    
    return (isMeanParam && hasVariance) || hasMeanAndVariance;
}

// Check if outcome has categorical data
function hasCategoricalData(outcome) {
    if (!outcome.classes || outcome.classes.length === 0) return false;
    
    // Check for multiple categories or single category with multiple measurements
    for (const cls of outcome.classes) {
        if (cls.categories && cls.categories.length > 1) {
            return true;
        } else if (cls.categories && cls.categories.length === 1) {
            const cat = cls.categories[0];
            if (cat.measurements && cat.measurements.length > 1) {
                return true;
            }
        }
    }
    
    return false;
}

// Check if outcome has time-based data points
function hasTimePointData(outcome) {
    if (!outcome.classes || outcome.classes.length === 0) return false;
    
    // Check for class titles that indicate time points
    const timeRegex = /^(baseline|week|month|day|hour|minute|year|follow.?up|visit)/i;
    
    for (const cls of outcome.classes) {
        if (cls.title && timeRegex.test(cls.title)) {
            return true;
        }
    }
    
    return false;
}

// Create bell curve distribution chart (similar to your example image)
function createDistributionChart(outcome, canvas, interpretationContainer) {
    const groups = outcome.groups || [];
    const colors = ['#3B82F6', '#10B981', '#F05252', '#8B5CF6', '#F59E0B', '#EC4899'];
    
    if (!groups.length) return;
    
    // Extract means and standard deviations for each group
    const distributionData = [];
    
    // Determine which outcome classes to use
    let classesToUse = outcome.classes;
    if (outcome.classes.length > 1) {
        // For multiple classes, try to find the most relevant ones (like final timepoint)
        const finalTimepoint = outcome.classes.find(c => 
            (c.title && /final|end|last|completion/i.test(c.title)) || 
            outcome.classes[outcome.classes.length - 1]
        );
        
        if (finalTimepoint) {
            classesToUse = [finalTimepoint];
        }
    }
    
    // Extract measurement data
    classesToUse.forEach(cls => {
        if (cls.categories && cls.categories.length > 0) {
            cls.categories.forEach(cat => {
                if (cat.measurements && cat.measurements.length > 0) {
                    cat.measurements.forEach(measurement => {
                        const groupId = measurement.groupId;
                        const group = groups.find(g => g.id === groupId);
                        if (!group) return;
                        
                        const value = parseFloat(measurement.value);
                        
                        // Get standard deviation or error
                        let spreadValue = 0;
                        if (measurement.spread) {
                            spreadValue = parseFloat(measurement.spread);
                        } else if (measurement.dispersion) {
                            spreadValue = parseFloat(measurement.dispersion);
                        }
                        
                        if (!isNaN(value) && !isNaN(spreadValue)) {
                            distributionData.push({
                                group: group.title,
                                mean: value,
                                stdDev: spreadValue,
                                isError: outcome.dispersionType === 'Standard Error' || 
                                         outcome.dispersionType === 'STANDARD_ERROR'
                            });
                        }
                    });
                }
            });
        }
    });
    
    // If we have analysis data with p-values, add that information
    let pValueInfo = "";
    if (outcome.analyses && outcome.analyses.length > 0) {
        const analysis = outcome.analyses[0];
        if (analysis.pValue) {
            pValueInfo = `<p class="font-semibold mt-2">Statistical Analysis:</p>
                         <p>p-value: ${analysis.pValue}</p>`;
            
            if (analysis.statisticalMethod) {
                pValueInfo += `<p>Method: ${analysis.statisticalMethod}</p>`;
            }
            
            if (analysis.ciLowerLimit && analysis.ciUpperLimit) {
                pValueInfo += `<p>${analysis.ciPctValue || 95}% CI: [${analysis.ciLowerLimit}, ${analysis.ciUpperLimit}]</p>`;
            }
        }
    }
    
    // Generate bell curve data for visualization
    const chartData = {
        datasets: distributionData.map((data, index) => {
            const color = colors[index % colors.length];
            const points = 100;
            
            // For standard error, convert to standard deviation
            let stdDev = data.stdDev;
            if (data.isError && outcome.denoms) {
                // Try to find sample size to convert SE to SD
                const groupDenom = outcome.denoms[0]?.counts.find(c => 
                    groups.find(g => g.id === c.groupId)?.title === data.group
                );
                
                if (groupDenom) {
                    const n = parseInt(groupDenom.value);
                    if (!isNaN(n) && n > 0) {
                        stdDev = data.stdDev * Math.sqrt(n);
                    }
                }
            }
            
            // Generate normal distribution curve points
            const distributionPoints = generateNormalDistribution(data.mean, stdDev, points);
            
            return {
                label: `${data.group} (μ=${data.mean.toFixed(1)}, σ=${stdDev.toFixed(1)})`,
                data: distributionPoints,
                borderColor: color,
                backgroundColor: color + '20', // Add transparency
                borderWidth: 2,
                pointRadius: 0,
                fill: true,
                tension: 0.4
            };
        })
    };
    
    // Set up chart configuration
    const config = {
        type: 'line',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: sanitizeTitle(outcome.title),
                    font: {
                        size: 14,
                        weight: 'bold'
                    }
                },
                subtitle: {
                    display: true,
                    text: `Time Frame: ${outcome.timeFrame || 'Not specified'}`,
                    font: {
                        size: 12,
                        style: 'italic'
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                },
                legend: {
                    position: 'top'
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: `${outcome.title} (${outcome.unitOfMeasure || 'Value'})`,
                        font: {
                            weight: 'bold'
                        }
                    },
                    grid: {
                        display: true,
                        drawBorder: true
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Probability Density',
                        font: {
                            weight: 'bold'
                        }
                    },
                    beginAtZero: true
                }
            }
        }
    };
    
    // Add indicator lines for means
    const meanLines = distributionData.map((data, index) => {
        return {
            type: 'line',
            id: `mean-line-${index}`,
            mode: 'vertical',
            scaleID: 'x',
            value: data.mean,
            borderColor: colors[index % colors.length],
            borderWidth: 2,
            borderDash: [6, 4],
            label: {
                enabled: true,
                content: `μ=${data.mean.toFixed(1)}`,
                position: 'top'
            }
        };
    });
    
    config.options.plugins.annotation = {
        annotations: meanLines
    };
    
    // Add interpretation
    updateInterpretation(interpretationContainer, outcome, distributionData, pValueInfo);
    
    // Create the chart
    const chart = new Chart(canvas, config);
    canvas._chart = chart;
}

// Create categorical chart for outcome data
function createCategoricalChart(outcome, canvas, interpretationContainer) {
    const groups = outcome.groups || [];
    const colors = ['#3B82F6', '#10B981', '#F05252', '#8B5CF6', '#F59E0B', '#EC4899'];
    
    if (!groups.length) return;
    
    // Extract category data
    const categories = [];
    const groupValues = {};
    
    // Initialize group values
    groups.forEach(group => {
        groupValues[group.id] = {};
    });
    
    // Process all classes and categories
    outcome.classes.forEach(cls => {
        if (cls.categories && cls.categories.length > 0) {
            cls.categories.forEach(cat => {
                const categoryName = cat.title || 'Category';
                if (!categories.includes(categoryName)) {
                    categories.push(categoryName);
                }
                
                if (cat.measurements && cat.measurements.length > 0) {
                    cat.measurements.forEach(measurement => {
                        const value = parseFloat(measurement.value);
                        if (!isNaN(value)) {
                            groupValues[measurement.groupId][categoryName] = value;
                        }
                    });
                }
            });
        }
    });
    
    // Prepare data for Chart.js
    const datasets = groups.map((group, index) => {
        const color = colors[index % colors.length];
        return {
            label: group.title,
            data: categories.map(cat => groupValues[group.id][cat] || 0),
            backgroundColor: color,
            borderColor: color,
            borderWidth: 1
        };
    });
    
    // Set up chart configuration
    const config = {
        type: 'bar',
        data: {
            labels: categories,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: sanitizeTitle(outcome.title),
                    font: {
                        size: 14,
                        weight: 'bold'
                    }
                },
                subtitle: {
                    display: true,
                    text: `Time Frame: ${outcome.timeFrame || 'Not specified'}`,
                    font: {
                        size: 12,
                        style: 'italic'
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                },
                legend: {
                    position: 'top'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: outcome.unitOfMeasure || 'Value',
                        font: {
                            weight: 'bold'
                        }
                    }
                }
            }
        }
    };
    
    // Add interpretation
    updateCategoricalInterpretation(interpretationContainer, outcome, groups, categories, groupValues);
    
    // Create the chart
    const chart = new Chart(canvas, config);
    canvas._chart = chart;
}

// Create time series chart for longitudinal data
function createTimeSeriesChart(outcome, canvas, interpretationContainer) {
    const groups = outcome.groups || [];
    const colors = ['#3B82F6', '#10B981', '#F05252', '#8B5CF6', '#F59E0B', '#EC4899'];
    
    if (!groups.length) return;
    
    // Extract time points and values
    const timePoints = [];
    const groupValues = {};
    
    // Initialize group values
    groups.forEach(group => {
        groupValues[group.id] = {};
    });
    
    // Process classes as time points
    outcome.classes.forEach(cls => {
        const timePoint = cls.title || 'Time Point';
        if (!timePoints.includes(timePoint)) {
            timePoints.push(timePoint);
        }
        
        if (cls.categories && cls.categories.length > 0) {
            cls.categories.forEach(cat => {
                if (cat.measurements && cat.measurements.length > 0) {
                    cat.measurements.forEach(measurement => {
                        const value = parseFloat(measurement.value);
                        if (!isNaN(value)) {
                            groupValues[measurement.groupId][timePoint] = value;
                        }
                    });
                }
            });
        }
    });
    
    // Sort time points chronologically if possible
    const timeOrder = {
        'baseline': 0,
        'screening': 1
    };
    
    timePoints.sort((a, b) => {
        // Check for special time points first
        if (a.toLowerCase() in timeOrder && b.toLowerCase() in timeOrder) {
            return timeOrder[a.toLowerCase()] - timeOrder[b.toLowerCase()];
        } else if (a.toLowerCase() in timeOrder) {
            return -1;
        } else if (b.toLowerCase() in timeOrder) {
            return 1;
        }
        
        // Try to extract numeric values for comparison
        const aMatch = a.match(/(\d+)\s*(day|week|month|year|hr|min|hour|minute|second)/i);
        const bMatch = b.match(/(\d+)\s*(day|week|month|year|hr|min|hour|minute|second)/i);
        
        if (aMatch && bMatch) {
            const aValue = parseInt(aMatch[1]);
            const bValue = parseInt(bMatch[1]);
            
            if (!isNaN(aValue) && !isNaN(bValue)) {
                if (aMatch[2].toLowerCase() === bMatch[2].toLowerCase()) {
                    return aValue - bValue;
                }
            }
        }
        
        // Default alphabetical sort
        return a.localeCompare(b);
    });
    
    // Prepare data for Chart.js
    const datasets = groups.map((group, index) => {
        const color = colors[index % colors.length];
        return {
            label: group.title,
            data: timePoints.map(time => groupValues[group.id][time] || null),
            borderColor: color,
            backgroundColor: color + '20',
            tension: 0.3,
            fill: false
        };
    });
    
    // Set up chart configuration
    const config = {
        type: 'line',
        data: {
            labels: timePoints,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: sanitizeTitle(outcome.title),
                    font: {
                        size: 14,
                        weight: 'bold'
                    }
                },
                subtitle: {
                    display: true,
                    text: `Time Frame: ${outcome.timeFrame || 'Not specified'}`,
                    font: {
                        size: 12,
                        style: 'italic'
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                },
                legend: {
                    position: 'top'
                }
            },
            scales: {
                y: {
                    title: {
                        display: true,
                        text: outcome.unitOfMeasure || 'Value',
                        font: {
                            weight: 'bold'
                        }
                    }
                }
            }
        }
    };
    
    // Add interpretation
    updateTimeSeriesInterpretation(interpretationContainer, outcome, groups, timePoints, groupValues);
    
    // Create the chart
    const chart = new Chart(canvas, config);
    canvas._chart = chart;
}

// Simple fallback bar chart for any outcome data
function createSimpleBarChart(outcome, canvas, interpretationContainer) {
    const groups = outcome.groups || [];
    const colors = ['#3B82F6', '#10B981', '#F05252', '#8B5CF6', '#F59E0B', '#EC4899'];
    
    if (!groups.length) return;
    
    // Get values for each group
    const groupData = [];
    
    // Try to find values from any structure
    if (outcome.classes && outcome.classes.length > 0) {
        for (const cls of outcome.classes) {
            if (cls.categories && cls.categories.length > 0) {
                for (const cat of cls.categories) {
                    if (cat.measurements && cat.measurements.length > 0) {
                        for (const measurement of cat.measurements) {
                            const value = parseFloat(measurement.value);
                            if (!isNaN(value)) {
                                const group = groups.find(g => g.id === measurement.groupId);
                                if (group) {
                                    groupData.push({
                                        group: group.title,
                                        value: value
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Set up chart configuration
    const config = {
        type: 'bar',
        data: {
            labels: groupData.map(d => d.group),
            datasets: [{
                label: outcome.title,
                data: groupData.map(d => d.value),
                backgroundColor: groupData.map((_, i) => colors[i % colors.length]),
                borderColor: groupData.map((_, i) => colors[i % colors.length]),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: sanitizeTitle(outcome.title),
                    font: {
                        size: 14,
                        weight: 'bold'
                    }
                },
                subtitle: {
                    display: true,
                    text: `Time Frame: ${outcome.timeFrame || 'Not specified'}`,
                    font: {
                        size: 12,
                        style: 'italic'
                    }
                },
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: outcome.unitOfMeasure || 'Value',
                        font: {
                            weight: 'bold'
                        }
                    }
                }
            }
        }
    };
    
    // Add interpretation
    const message = `<p class="font-semibold">Outcome Summary:</p>
                    <p>${outcome.title}</p>
                    <p class="text-xs text-gray-500 mt-1">${outcome.description || ''}</p>
                    <ul class="mt-2">
                        ${groupData.map(d => `<li>${d.group}: ${d.value} ${outcome.unitOfMeasure || ''}</li>`).join('')}
                    </ul>`;
    
    interpretationContainer.innerHTML = message;
    
    // Create the chart
    const chart = new Chart(canvas, config);
    canvas._chart = chart;
}

// Helper function to generate normal distribution data points
function generateNormalDistribution(mean, stdDev, points = 100) {
    if (isNaN(mean) || isNaN(stdDev) || stdDev <= 0) {
        console.warn("Invalid parameters for normal distribution:", { mean, stdDev });
        return Array(points).fill({x: 0, y: 0});
    }
    
    const data = [];
    const min = mean - 3 * stdDev;
    const max = mean + 3 * stdDev;
    const step = (max - min) / points;
    
    for (let x = min; x <= max; x += step) {
        const y = (1 / (stdDev * Math.sqrt(2 * Math.PI))) * 
                  Math.exp(-Math.pow(x - mean, 2) / (2 * Math.pow(stdDev, 2)));
        data.push({x, y});
    }
    
    return data;
}

// Helper function to update interpretation for distribution chart
function updateInterpretation(container, outcome, distributionData, pValueInfo) {
    // Determine if lower or higher values are better based on outcome title
    const lowerIsBetter = isLowerValueBetter(outcome.title);
    
    // Prepare interpretation message
    let interpretation = `<p class="font-semibold">Distribution Analysis:</p>
                         <p>${outcome.title}</p>
                         <p class="text-xs text-gray-500 mt-1">${outcome.description || ''}</p>`;
    
    // Add group summaries
    interpretation += `<p class="font-semibold mt-2">Group Comparisons:</p>
                      <ul class="list-disc ml-4">`;
    
    distributionData.forEach(data => {
        interpretation += `<li>${data.group}: Mean = ${data.mean.toFixed(2)}, SD = ${data.stdDev.toFixed(2)}</li>`;
    });
    
    interpretation += `</ul>`;
    
    // Add statistical significance if available
    if (pValueInfo) {
        interpretation += pValueInfo;
    }
    
// Find experimental and control groups
if (distributionData.length > 1) {
    // Find experimental and control groups
    let experimentalGroup, controlGroup;
    
    // Try to identify control/placebo group
    for (let i = 0; i < distributionData.length; i++) {
        const groupName = distributionData[i].group.toLowerCase();
        if (groupName.includes('placebo') || groupName.includes('control')) {
            controlGroup = distributionData[i];
        } else if (groupName.includes('experimental') || 
                 groupName.includes('treatment') || 
                 groupName.includes('intervention')) {
            experimentalGroup = distributionData[i];
        }
    }
    
    // If we couldn't clearly identify, assume first is control, second is experimental
    if (!controlGroup && distributionData.length >= 2) {
        controlGroup = distributionData[0];
        experimentalGroup = distributionData[1];
    }
    
    // If we have both groups, add comparison
    if (controlGroup && experimentalGroup) {
        const diff = experimentalGroup.mean - controlGroup.mean;
        const diffPercent = (diff / Math.abs(controlGroup.mean)) * 100;
        
        const betterWorse = lowerIsBetter ? 
            (diff < 0 ? 'better' : 'worse') : 
            (diff > 0 ? 'better' : 'worse');
        
        interpretation += `<p class="font-semibold mt-2">Clinical Interpretation:</p>
                         <p>The experimental group showed a ${Math.abs(diffPercent).toFixed(1)}% ${betterWorse} outcome compared to control.</p>`;
    }
}

container.innerHTML = interpretation;
}

// Helper function to update interpretation for categorical chart
function updateCategoricalInterpretation(container, outcome, groups, categories, groupValues) {
// Prepare interpretation message
let interpretation = `<p class="font-semibold">Categorical Analysis:</p>
                     <p>${outcome.title}</p>
                     <p class="text-xs text-gray-500 mt-1">${outcome.description || ''}</p>`;

// Add group comparisons
interpretation += `<p class="font-semibold mt-2">Category Values:</p>
                  <table class="border-collapse w-full text-sm">
                    <thead>
                      <tr>
                        <th class="border px-2 py-1">Category</th>
                        ${groups.map(g => `<th class="border px-2 py-1">${g.title}</th>`).join('')}
                      </tr>
                    </thead>
                    <tbody>`;

categories.forEach(cat => {
    interpretation += `<tr>
                       <td class="border px-2 py-1">${cat}</td>
                       ${groups.map(g => `<td class="border px-2 py-1">${groupValues[g.id][cat]?.toFixed(2) || 'N/A'}</td>`).join('')}
                     </tr>`;
});

interpretation += `</tbody></table>`;

// Add statistical significance if available
if (outcome.analyses && outcome.analyses.length > 0) {
    const analysis = outcome.analyses[0];
    if (analysis.pValue) {
        interpretation += `<p class="font-semibold mt-2">Statistical Analysis:</p>
                       <p>p-value: ${analysis.pValue}</p>`;
        
        if (analysis.statisticalMethod) {
            interpretation += `<p>Method: ${analysis.statisticalMethod}</p>`;
        }
        
        if (analysis.ciLowerLimit && analysis.ciUpperLimit) {
            interpretation += `<p>${analysis.ciPctValue || 95}% CI: [${analysis.ciLowerLimit}, ${analysis.ciUpperLimit}]</p>`;
        }
    }
}

container.innerHTML = interpretation;
}

// Helper function to update interpretation for time series chart
function updateTimeSeriesInterpretation(container, outcome, groups, timePoints, groupValues) {
// Determine if lower or higher values are better based on outcome title
const lowerIsBetter = isLowerValueBetter(outcome.title);

// Prepare interpretation message
let interpretation = `<p class="font-semibold">Time Series Analysis:</p>
                     <p>${outcome.title}</p>
                     <p class="text-xs text-gray-500 mt-1">${outcome.description || ''}</p>`;

// Try to identify baseline and final time points
const baselineIndex = timePoints.findIndex(t => 
    t.toLowerCase().includes('baseline') || 
    t.toLowerCase().includes('screening') || 
    t === timePoints[0]
);

const finalIndex = timePoints.length - 1;

// Add change over time analysis if we have baseline and final
if (baselineIndex !== -1 && finalIndex > baselineIndex) {
    const baselineTime = timePoints[baselineIndex];
    const finalTime = timePoints[finalIndex];
    
    interpretation += `<p class="font-semibold mt-2">Change from ${baselineTime} to ${finalTime}:</p>
                      <ul class="list-disc ml-4">`;
    
    groups.forEach(group => {
        const baseline = groupValues[group.id][baselineTime];
        const final = groupValues[group.id][finalTime];
        
        if (baseline !== undefined && final !== undefined) {
            const change = final - baseline;
            const percentChange = (change / Math.abs(baseline)) * 100;
            
            const direction = change > 0 ? 'increase' : (change < 0 ? 'decrease' : 'no change');
            const betterWorse = lowerIsBetter ?
                (change < 0 ? 'improvement' : (change > 0 ? 'worsening' : 'no change')) :
                (change > 0 ? 'improvement' : (change < 0 ? 'worsening' : 'no change'));
            
            interpretation += `<li>${group.title}: ${Math.abs(percentChange).toFixed(1)}% ${direction} (${betterWorse})</li>`;
        }
    });
    
    interpretation += `</ul>`;
}

// Add statistical significance if available
if (outcome.analyses && outcome.analyses.length > 0) {
    const analysis = outcome.analyses[0];
    if (analysis.pValue) {
        interpretation += `<p class="font-semibold mt-2">Statistical Analysis:</p>
                       <p>p-value: ${analysis.pValue}</p>`;
        
        if (analysis.statisticalMethod) {
            interpretation += `<p>Method: ${analysis.statisticalMethod}</p>`;
        }
    }
}

container.innerHTML = interpretation;
}

// Helper function to determine if lower values are better for outcomes like depression scales
function isLowerValueBetter(title) {
if (!title) return false;

const lowerIsBetterTerms = [
    'depression', 'anxiety', 'stress', 'pain', 'fatigue', 'symptom', 
    'adverse', 'negative', 'score', 'ham-d', 'hamd', 'madrs', 'phq',
    'hamilton', 'montgomery', 'qids', 'beck', 'bdi', 'gad', 'panss'
];

const titleLower = title.toLowerCase();
return lowerIsBetterTerms.some(term => titleLower.includes(term));
}

// Helper function to sanitize long titles for chart display
function sanitizeTitle(title) {
if (!title) return 'Outcome Measure';

// If title is too long, truncate and add ellipsis
return title.length > 60 ? title.substring(0, 57) + '...' : title;
}

// Handling of specific study data loading and API interactions
async function fetchStudies(drug, condition, hasResults) {
try {
    condition = condition || "Treatment Resistant Depression";
    
    // Using our backend endpoint
    const params = {
        condition: condition,
        intervention: drug,
        hasResults: hasResults,
        fields: "protocolSection,resultsSection,hasResults",
        pageSize: 100
    };
    
    console.log("Fetching studies with params:", params);
    const response = await axios.get(`${API_BASE_URL}/studies/search`, { 
        params,
        headers: {
            'Accept': 'application/json',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        }
    });
    
    console.log("Studies search response status:", response.status);
    let studies = response.data.data.studies || [];
    
    return studies;
} catch (error) {
    console.error("Error fetching studies:", error);
    return [];
}
}

async function fetchStudyDetails(nctId) {
// Skip if we've already failed to fetch this study
if (appState.failedStudyIds.has(nctId)) {
    console.log(`Skipping already failed study ID: ${nctId}`);
    return null;
}

try {
    console.log(`Fetching details for study: ${nctId}`);
    const response = await axios.get(`${API_BASE_URL}/studies/${nctId}`, {
        params: {
            timestamp: new Date().getTime() // Add timestamp to prevent caching
        },
        headers: {
            'Accept': 'application/json',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        }
    });
    
    console.log(`Study details response status for ${nctId}:`, response.status);
    return response.data.data;
} catch (error) {
    console.error(`Error fetching details for ${nctId}:`, error);
    appState.failedStudyIds.add(nctId); // Track failed requests
    return null;
}
}

async function viewStudyDetails(nctId) {
appState.currentStudyId = nctId;
displayLoading(true);

// Check if we already have the study details cached
let studyDetails = appState.studyDetails[nctId];

// If not cached, fetch from API
if (!studyDetails) {
    studyDetails = await fetchStudyDetails(nctId);
    
    if (studyDetails) {
        // Cache the study details
        appState.studyDetails[nctId] = studyDetails;
    }
}

if (!studyDetails) {
    displayLoading(false);
    alert('Error loading study details. Please try again.');
    return;
}

// Display study details
displayStudyDetail(studyDetails);

// Show the detail section
showSection(elements.studyDetailSection, true);
elements.studyDetailSection.scrollIntoView({ behavior: 'smooth' });
displayLoading(false);
}

// Helper function to copy trial data to clipboard
function copyTrialDataToClipboard(nctId) {
const studyDetail = appState.studyDetails[nctId];

if (!studyDetail) {
    alert('Study details not available for copying.');
    return;
}

// Format study data as JSON
const studyData = JSON.stringify(studyDetail, null, 2);

// Create a temporary textarea to facilitate copying
const textarea = document.createElement('textarea');
textarea.value = studyData;
textarea.setAttribute('readonly', '');
textarea.style.position = 'absolute';
textarea.style.left = '-9999px';
document.body.appendChild(textarea);

// Copy the text
textarea.select();
document.execCommand('copy');

// Clean up
document.body.removeChild(textarea);

// Notify user
alert('Study data copied to clipboard.');
}

// Utility function to show/hide loading indicator
function displayLoading(isLoading) {
if (!elements.loadingIndicator) {
    elements.loadingIndicator = document.getElementById('loadingIndicator');
}

if (elements.loadingIndicator) {
    elements.loadingIndicator.style.display = isLoading ? 'flex' : 'none';
}
}

// Utility function to show/hide a section
function showSection(section, show) {
if (section) {
    section.style.display = show ? 'block' : 'none';
}
}

// Function to display studies in the UI
function displayStudies(studies) {
elements.studiesList.innerHTML = '';
elements.studyCount.textContent = studies.length;

if (studies.length === 0) {
    elements.studiesList.innerHTML = `
        <div class="text-center p-4 text-gray-500">
            <p>No studies found matching the current filters.</p>
        </div>
    `;
    return;
}

// Sort studies by phase
const phaseOrder = { 
    "PRE_PHASE": 0, 
    "PHASE1": 1, 
    "PHASE1_PHASE2": 1.5,
    "PHASE2": 2, 
    "PHASE3": 3, 
    "PHASE4": 4 
};

studies.sort((a, b) => {
    const phaseA = a.protocolSection?.designModule?.phases?.[0] || "PRE_PHASE";
    const phaseB = b.protocolSection?.designModule?.phases?.[0] || "PRE_PHASE";
    return (phaseOrder[phaseA] || 0) - (phaseOrder[phaseB] || 0);
});

studies.forEach(study => {
    const nctId = study.protocolSection?.identificationModule?.nctId;
    const title = study.protocolSection?.identificationModule?.briefTitle;
    const phase = study.protocolSection?.designModule?.phases?.[0] || "N/A";
    const status = study.protocolSection?.statusModule?.overallStatus;
    const sponsor = study.protocolSection?.identificationModule?.organization?.fullName;
    const hasResults = study.hasResults;
    
    // Determine if this is a TRD-specific study
    const briefTitle = study.protocolSection?.identificationModule?.briefTitle?.toLowerCase() || '';
    const officialTitle = study.protocolSection?.identificationModule?.officialTitle?.toLowerCase() || '';
    const briefSummary = study.protocolSection?.descriptionModule?.briefSummary?.toLowerCase() || '';
    
    const trdTerms = [
        'treatment-resistant depression', 
        'treatment resistant depression',
        'trd',
        'refractory depression'
    ];
    
    const isTRDSpecific = trdTerms.some(term => 
        briefTitle.includes(term) || 
        officialTitle.includes(term) || 
        briefSummary.includes(term)
    );
    
    const card = document.createElement('div');
    card.className = 'bg-white p-4 rounded-lg border border-gray-200 hover:shadow-md transition duration-200';
    card.innerHTML = `
        <div class="flex flex-col md:flex-row gap-2 md:items-center md:justify-between mb-3">
            <div class="flex gap-2 items-center flex-wrap">
                <span class="inline-block w-3 h-3 rounded-full" style="background-color: ${getPhaseColor(phase)}"></span>
                <span class="text-sm font-medium">${formatPhase(phase)}</span>
                ${getStatusBadge(status)}
                ${isTRDSpecific ? '<span class="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full">TRD-Specific</span>' : ''}
            </div>
            <div>
                <span class="text-xs text-gray-500">${nctId}</span>
                ${hasResults ? '<span class="ml-2 text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">Has Results</span>' : ''}
            </div>
        </div>
        <h3 class="text-lg font-medium mb-2">${title}</h3>
        <p class="text-sm text-gray-600 mb-3">Sponsor: ${sponsor || 'Unknown'}</p>
        <button data-nctid="${nctId}" class="view-study-btn text-primary hover:text-blue-700 text-sm font-medium flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            View Study Details
        </button>
    `;
    elements.studiesList.appendChild(card);
    
    // Add event listener to the view button
    card.querySelector('.view-study-btn').addEventListener('click', () => {
        viewStudyDetails(nctId);
    });
});
}

// Function to display detailed study information
function displayStudyDetail(study) {
console.log(study);
const identification = study.protocolSection?.identificationModule || {};
const design = study.protocolSection?.designModule || {};
const description = study.protocolSection?.descriptionModule || {};
const arms = study.protocolSection?.armsInterventionsModule?.armGroups || [];
const eligibility = study.protocolSection?.eligibilityModule || {};
const outcomes = study.resultsSection?.outcomeMeasuresModule?.outcomeMeasures || [];

const primaryOutcomes = outcomes.filter(outcome => outcome.type === "PRIMARY");
const secondaryOutcomes = outcomes.filter(outcome => outcome.type === "SECONDARY");

// Determine if this is a TRD-specific study
const title = identification.briefTitle?.toLowerCase() || '';
const officialTitle = identification.officialTitle?.toLowerCase() || '';
const briefSummary = description.briefSummary?.toLowerCase() || '';
const detailedDescription = description.detailedDescription?.toLowerCase() || '';

const trdTerms = [
    'treatment-resistant depression', 
    'treatment resistant depression',
    'trd',
    'refractory depression',
    'treatment-refractory depression'
];

const isTRDSpecific = trdTerms.some(term => 
    title.includes(term) || 
    officialTitle.includes(term) || 
    briefSummary.includes(term) || 
    detailedDescription.includes(term)
);

elements.studyDetailContent.innerHTML = `
    <div class="border-b pb-4 mb-4">
        <div class="flex justify-between items-start">
            <h2 class="text-2xl font-semibold mb-2">${identification.briefTitle || 'Untitled Study'}</h2>
            <button id="copyStudyData" class="text-primary hover:text-blue-700 flex items-center text-sm">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-4M16 5h2a2 2 0 012 2v4M21 14H11" />
                </svg>
                Copy Data
            </button>
        </div>
        <div class="flex flex-wrap gap-2 mb-2">
            <span class="bg-gray-100 text-sm px-3 py-1 rounded-full">NCT ID: ${identification.nctId || 'N/A'}</span>
            <span class="bg-gray-100 text-sm px-3 py-1 rounded-full">Phase: ${formatPhase(design.phases?.[0] || 'N/A')}</span>
            <span class="bg-gray-100 text-sm px-3 py-1 rounded-full">Status: ${study.protocolSection?.statusModule?.overallStatus || 'N/A'}</span>
            ${isTRDSpecific ? '<span class="bg-purple-100 text-purple-800 text-sm px-3 py-1 rounded-full">TRD-Specific</span>' : ''}
        </div>
        <p class="text-sm text-gray-600">Sponsor: ${identification.organization?.fullName || 'N/A'}</p>
    </div>
            
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
            <h3 class="text-lg font-medium mb-2">Study Design</h3>
            <div class="bg-gray-50 p-3 rounded-lg">
                <p><strong>Study Type:</strong> ${design.studyType || 'N/A'}</p>
                <p><strong>Allocation:</strong> ${design.designInfo?.allocation || 'N/A'}</p>
                <p><strong>Intervention Model:</strong> ${design.designInfo?.interventionModel || 'N/A'}</p>
                <p><strong>Masking:</strong> ${design.designInfo?.maskingInfo?.masking || 'N/A'}</p>
                <p><strong>Primary Purpose:</strong> ${design.designInfo?.primaryPurpose || 'N/A'}</p>
            </div>
        </div>
        
        <div>
            <h3 class="text-lg font-medium mb-2">Enrollment</h3>
            <div class="bg-gray-50 p-3 rounded-lg">
                <p><strong>Enrollment:</strong> ${design.enrollmentInfo?.count || 'N/A'}</p>
                <p><strong>Sex:</strong> ${eligibility.sex || 'N/A'}</p>
                <p><strong>Minimum Age:</strong> ${eligibility.minimumAge || 'N/A'}</p>
                <p><strong>Maximum Age:</strong> ${eligibility.maximumAge || 'N/A'}</p>
                <p><strong>Healthy Volunteers:</strong> ${eligibility.healthyVolunteers || 'N/A'}</p>
            </div>
        </div>
    </div>
            
    <div class="mb-6">
        <h3 class="text-lg font-medium mb-2">Brief Summary</h3>
        <div class="bg-gray-50 p-3 rounded-lg">
            <p>${description.briefSummary || 'No summary available.'}</p>
        </div>
    </div>
            
    <div class="mb-6">
        <h3 class="text-lg font-medium mb-2">Arms and Interventions</h3>
        <div class="bg-gray-50 p-3 rounded-lg">
            ${arms.length > 0 ? 
                `<div class="grid grid-cols-1 gap-3">
                    ${arms.map(arm => `
                        <div class="border-b border-gray-200 pb-3 last:border-b-0 last:pb-0">
                            <p class="font-medium">${arm.label} (${arm.type})</p>
                            <p class="text-sm">${arm.description || 'No description available.'}</p>
                        </div>
                    `).join('')}
                </div>` : 
                '<p class="italic text-gray-500">No arms or interventions information available.</p>'
            }
        </div>
    </div>
            
    <div id="outcomeVisuals" class="mb-6">
        <h3 class="text-lg font-medium mb-2">Outcome Measurements</h3>
        ${outcomes.length > 0 ? 
            `<div class="space-y-6">
                ${primaryOutcomes.length > 0 ? 
                    `<div>
                        <h4 class="text-md font-medium mb-2">Primary Outcomes</h4>
                        <div class="space-y-4">
                            ${primaryOutcomes.map((outcome, idx) => `
                                <div class="bg-gray-50 p-3 rounded-lg">
                                    <p class="font-medium">${outcome.title}</p>
                                    <p class="text-sm mb-2">${outcome.description || 'No description available.'}</p>
                                    <p class="text-sm text-gray-600">Time Frame: ${outcome.timeFrame || 'Not specified'}</p>
                                    <div class="relative h-64 mt-3">
                                        <canvas id="outcome_${identification.nctId}_${idx}"></canvas>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>` : 
                    ''}
                
                ${secondaryOutcomes.length > 0 ? 
                    `<div>
                        <h4 class="text-md font-medium mb-2">Secondary Outcomes</h4>
                        <div class="space-y-4">
                            ${secondaryOutcomes.map((outcome, idx) => `
                                <div class="bg-gray-50 p-3 rounded-lg">
                                    <p class="font-medium">${outcome.title}</p>
                                    <p class="text-sm mb-2">${outcome.description || 'No description available.'}</p>
                                    <p class="text-sm text-gray-600">Time Frame: ${outcome.timeFrame || 'Not specified'}</p>
                                    <div class="relative h-64 mt-3">
                                        <canvas id="outcome_secondary_${identification.nctId}_${idx}"></canvas>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>` : 
                    ''}
            </div>` : 
            '<p class="italic text-gray-500">No outcome measurements available.</p>'
        }
    </div>
            
    <div class="mt-6 text-center">
        <a href="https://clinicaltrials.gov/study/${identification.nctId}" target="_blank" class="inline-flex items-center text-primary hover:text-blue-700">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            View full study on ClinicalTrials.gov
        </a>
    </div>
`;

// Create outcome charts after content is added to DOM
setTimeout(() => {
    createOutcomeCharts(study);
    
    // Add event listener for copy button
    const copyButton = document.getElementById('copyStudyData');
    if (copyButton) {
        copyButton.addEventListener('click', () => {
            copyTrialDataToClipboard(identification.nctId);
        });
    }
}, 100);
}