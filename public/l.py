#!/usr/bin/env python3
"""
C1 Label Generator Script
Generates 1000 unique C1 labels following the specified format and outputs to a text file
"""

import datetime
import os

def get_current_time():
    """Generate formatted date time string in the format: 04 April 2025 17:23"""
    now = datetime.datetime.now()
    return now.strftime("%d %B %Y %H:%M")

def generate_label(index):
    """Generate a single C1 label with the given index"""
    # Generate a unique label number starting from DS903 (since DS902 was in the example)
    label_number = 903 + index
    label_id = f"DS{label_number}"
    
    # Get the current time
    current_time = get_current_time()
    
    # Create the XML label content
    return f"""<!-- Label {index + 1} -->
<LABEL>{label_id}</LABEL> <AT Name="IsCalculated">N</AT> <AT Name="SwitchSignForFlow">N</AT> <AT Name="SwitchTypeForFlow">N</AT> <AT Name="UserDefined1">DS</AT> <AT Name="UserDefined2"></AT> <AT Name="UserDefined3"></AT> <AT Name="SecurityClass">C1_AMT</AT> <AT Name="SubmissionGroup">1</AT> <DEFAULTPARENT>DS900</DEFAULTPARENT> <Note></Note> <Last_Edit_On>{current_time}</Last_Edit_On> <Last_Edit_By>mehmiva</Last_Edit_By> <Last_Edit>Added as a sibling of DS900</Last_Edit> <DESCRIPTION Language="English">TEST CUSTOM 1_COMP</DESCRIPTION>
</MEMBER> <MEMBER>
<NODE>
<PARENT>DS900</PARENT> <CHILD>{label_id}</CHILD> <AT Name="AggrWeight">1</AT>
</NODE>
<LOG Type="ADD" Dimension="Custom1" Label="{label_id}" Action="Added as a sibling of DS900" User="mehmiva" Date="{current_time}" />
"""

def generate_all_labels(output_file="C1_Labels_1000.txt"):
    """Generate 1000 labels and save to the specified output file"""
    with open(output_file, 'w') as f:
        # Write header
        f.write("# 1000 Unique C1 Labels\n\n")
        
        # Generate and write each label
        for i in range(1000):
            label = generate_label(i)
            f.write(label + "\n")
    
    # Return the path to the generated file
    return os.path.abspath(output_file)

if __name__ == "__main__":
    output_path = generate_all_labels()
    print(f"1000 labels generated and saved to: {output_path}")